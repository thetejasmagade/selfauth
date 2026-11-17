import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rmdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { MANIFEST_FILE, manifestSchema, type Manifest } from "@selfauth/migration";
import { LAYOUT_STRUCTURE, sha256, WORKSPACE_STRUCTURE } from "./plan.js";
import { renderRootPackageJson } from "./render.js";
import { flatLayoutMoves, hasFlatLayout } from "./project.js";

/**
 * `selfauth upgrade --reorganize`: moves a project made with SelfAuth ≤ 0.3 (app files side by
 * side in src/) into the grouped layout (src/config, src/email, src/db, src/http, src/routes),
 * rewrites the relative imports that point at moved files, and updates the manifest. Only paths
 * and import specifiers change; no file's logic is touched.
 */

/** The file's text, or null when it does not exist: one read, no check-then-read gap. */
async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

const SKIP = new Set(["node_modules", "dist", "build", "coverage", ".git", "generated"]);
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx|vue)$/;
/** `from "./x"`, `import("./x")`, `import "./x"`, `export … from "./x"`. */
const IMPORT = /((?:from|import)\s*\(?\s*)(["'])(\.{1,2}\/[^"']*|\.{1,2})\2/g;

async function sourceFiles(root: string, dir: string, out: string[] = []): Promise<string[]> {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const entry of await readdir(abs, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.endsWith(".d.ts")) continue;
    const rel = posix.join(dir, entry.name);
    if (entry.isDirectory()) await sourceFiles(root, rel, out);
    else if (SOURCE.test(entry.name)) out.push(rel);
  }
  return out;
}

export interface MovePlan {
  /** Files to move, project-relative: `from` → `to`. */
  moves: { from: string; to: string }[];
  /** Files whose import lines change (moved or not), project-relative, by their new path. */
  rewrites: string[];
  /** Why the plan cannot be applied (target exists, nothing to move). Empty when it can. */
  problems: string[];
}

interface Computed extends MovePlan {
  contents: Map<string, { before: string; after: string; from: string }>;
}

/** Moves files and rewrites relative imports across `scan`. Pure: nothing is written. */
export async function planMoves(
  root: string,
  mapping: Record<string, string>,
  scan: string[],
): Promise<Computed> {
  const moves = Object.entries(mapping)
    .filter(([from]) => existsSync(join(root, from)))
    .map(([from, to]) => ({ from, to }));
  const problems = moves
    .filter(({ to }) => existsSync(join(root, to)))
    .map(({ to }) => `${to} already exists`);
  const moved = Object.fromEntries(moves.map((m) => [m.from, m.to]));
  const newPathOf = (p: string) => moved[p] ?? p;

  const files = [...new Set((await Promise.all(scan.map((d) => sourceFiles(root, d)))).flat())];
  const contents: Computed["contents"] = new Map();
  for (const from of files) {
    const before = await readFile(join(root, from), "utf8");
    const to = newPathOf(from);
    const after = before.replace(IMPORT, (all, lead: string, quote: string, spec: string) => {
      const target = posix.normalize(posix.join(posix.dirname(from), spec));
      let next = posix.relative(posix.dirname(to), newPathOf(target));
      if (!next.startsWith(".")) next = `./${next}`;
      return next === spec ? all : `${lead}${quote}${next}${quote}`;
    });
    contents.set(to, { before, after, from });
  }
  const rewrites = [...contents].filter(([, c]) => c.before !== c.after).map(([to]) => to);
  return { moves, rewrites, problems, contents };
}

/** Applies a plan from `planMoves`. Returns the files it wrote (by new path). */
async function applyMoves(root: string, plan: Computed): Promise<void> {
  for (const { from, to } of plan.moves) {
    await mkdir(dirname(join(root, to)), { recursive: true });
    await rename(join(root, from), join(root, to));
    // A folder the move emptied (src/example/) is removed; one that still has files is kept.
    await rmdir(dirname(join(root, from))).catch(() => undefined);
  }
  for (const [to, { before, after }] of plan.contents) {
    if (before !== after) await writeFile(join(root, to), after);
  }
}

/**
 * Moving a full-stack project into two packages: `src/`, `test/`, `prisma/` and the backend's
 * config files go to server/, `web/` becomes client/. Whole folders move, so no import changes.
 */
export interface WorkspacePlan {
  moves: { from: string; to: string }[];
  /** Created or rewritten besides the moves. */
  other: string[];
  problems: string[];
}

export interface ReorganizePlan extends MovePlan {
  manifest: Manifest;
  scan: string[];
  mapping: Record<string, string>;
  /** Step 1: group the flat src/ (structure 1 → 2). False when the project already has it. */
  regroup: boolean;
  /** Step 2: split a full-stack project into server/ and client/ (structure 2 → 3). */
  workspace: WorkspacePlan | null;
}

/** A full-stack project made before the two-package layout: `src/` and `web/` side by side. */
export function needsWorkspace(manifest: Manifest | null): boolean {
  return (
    manifest?.options?.layout === "project" &&
    (manifest.options.frontend ?? "none") !== "none" &&
    (manifest.options.structure ?? 1) < WORKSPACE_STRUCTURE
  );
}

const SERVER_FOLDERS = ["src", "test", "prisma"];
const SERVER_FILES = [
  "prisma.config.ts",
  "tsconfig.json",
  "tsconfig.build.json",
  ".env.example",
  ".env",
  "package.json",
];

async function planWorkspace(dir: string): Promise<WorkspacePlan> {
  const moves = [
    ...SERVER_FOLDERS.map((f) => ({ from: f, to: `server/${f}` })),
    ...SERVER_FILES.map((f) => ({ from: f, to: `server/${f}` })),
    { from: "web", to: "client" },
  ].filter((m) => existsSync(join(dir, m.from)));
  const problems = ["server", "client"]
    .filter((d) => existsSync(join(dir, d)))
    .map((d) => `${d}/ already exists`);
  return {
    moves,
    other: [
      "package.json (new workspace root)",
      "server/package.json (scripts for the frontend removed, name -server)",
      ".gitignore (generated Prisma client pattern)",
      "server/selfauth.manifest.json and client/selfauth.manifest.json (replace selfauth.manifest.json)",
    ],
    problems,
  };
}

/** What `upgrade --reorganize` would do to a project made with an older layout. Reads only. */
export async function planReorganize(
  dir: string,
): Promise<ReorganizePlan & { computed: Computed }> {
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath))
    throw new Error(
      existsSync(join(dir, "server", MANIFEST_FILE))
        ? "this project already uses the two-package layout (server/ and client/); there is nothing to reorganize."
        : "not a SelfAuth project (selfauth.manifest.json not found)",
    );
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const regroup = hasFlatLayout(manifest);
  const workspace = needsWorkspace(manifest) ? await planWorkspace(dir) : null;
  if (!regroup && !workspace) {
    throw new Error(
      "this project already uses the current layout; there is nothing to reorganize.",
    );
  }
  const add = manifest.options?.layout === "add";
  const srcDir = manifest.options?.srcDir ?? "src";
  const mapping = regroup
    ? flatLayoutMoves({
        layout: manifest.options?.layout,
        srcDir,
        frontend: manifest.options?.frontend,
      })
    : {};
  // Project layout: src/, test/ and the frontend's src. Add layout: the whole source folder,
  // because the application's own files may import from selfauth/.
  const scan = regroup
    ? [
        add ? srcDir : "src",
        "test",
        ...(!add && (manifest.options?.frontend ?? "none") !== "none" ? ["web/src"] : []),
      ].map((d) => (d === "." ? "" : d))
    : [];
  const computed = await planMoves(dir, mapping, scan);
  const problems = [...computed.problems, ...(workspace?.problems ?? [])];
  if (regroup && computed.moves.length === 0)
    problems.push(
      "none of the files to move were found; has the project been reorganized by hand?",
    );
  return {
    manifest,
    scan,
    mapping,
    regroup,
    workspace,
    moves: computed.moves,
    rewrites: computed.rewrites,
    problems,
    computed,
  };
}

/**
 * Applies the plan and records it in the manifest. A generated file that was unedited before
 * stays "unedited": its recorded hash becomes the hash of the moved, import-rewritten content,
 * so a later `upgrade` still updates it. A file you had edited keeps its old hash and is
 * treated as yours.
 */
export async function applyReorganize(
  dir: string,
  plan: ReorganizePlan & { computed: Computed },
): Promise<void> {
  if (plan.problems.length) throw new Error(plan.problems.join("; "));
  if (plan.regroup) await applyRegroup(dir, plan);
  if (plan.workspace) await applyWorkspace(dir, plan.workspace);
}

async function applyRegroup(
  dir: string,
  plan: ReorganizePlan & { computed: Computed },
): Promise<void> {
  const { computed, manifest } = plan;
  const newPathOf = new Map(computed.moves.map((m) => [m.from, m.to]));
  const wasUnedited = new Map<string, boolean>();
  for (const entry of manifest.files ?? []) {
    const before = computed.contents.get(newPathOf.get(entry.path) ?? entry.path)?.before;
    wasUnedited.set(entry.path, before !== undefined && sha256(before) === entry.sha256);
  }
  await applyMoves(dir, computed);

  const files = await Promise.all(
    (manifest.files ?? []).map(async (entry) => {
      const path = newPathOf.get(entry.path) ?? entry.path;
      if (path === entry.path && !plan.rewrites.includes(path)) return entry;
      const content = await readIfExists(join(dir, path));
      const unedited = wasUnedited.get(entry.path) && content !== null;
      return { ...entry, path, sha256: unedited ? sha256(content) : entry.sha256 };
    }),
  );
  const next: Manifest = {
    ...manifest,
    options: { ...manifest.options!, structure: LAYOUT_STRUCTURE },
    files,
  };
  await writeFile(
    join(dir, MANIFEST_FILE),
    `${JSON.stringify(manifestSchema.parse(next), null, 2)}\n`,
  );
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Splits a structure-2 full-stack project into server/ and client/ (structure 3). */
async function applyWorkspace(dir: string, plan: WorkspacePlan): Promise<void> {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(join(dir, MANIFEST_FILE), "utf8")),
  );
  const frontend = manifest.options?.frontend ?? "none";
  const original = new Map<string, string>();
  for (const entry of manifest.files ?? []) {
    const path = join(dir, entry.path);
    const text = await readIfExists(path);
    if (text !== null) original.set(entry.path, text);
  }
  const rootPackage = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
    name?: string;
    scripts?: Record<string, string>;
  };
  const baseName = rootPackage.name ?? "app";

  await mkdir(join(dir, "server"), { recursive: true });
  for (const { from, to } of plan.moves) await rename(join(dir, from), join(dir, to));

  // server/package.json: the frontend's scripts move to the workspace root, and the two
  // packages need different names. A user's own scripts and dependencies are kept.
  const serverPackagePath = join(dir, "server", "package.json");
  const serverPackage = JSON.parse(await readFile(serverPackagePath, "utf8")) as typeof rootPackage;
  serverPackage.name = `${baseName}-server`;
  delete serverPackage.scripts?.["dev:web"];
  delete serverPackage.scripts?.["build:web"];
  await writeFile(serverPackagePath, json(serverPackage));

  await writeFile(
    join(dir, "package.json"),
    renderRootPackageJson({
      name: baseName,
      database: manifest.database.type === "postgresql" ? "postgresql" : "memory",
      frontend: frontend === "react" ? "react" : "vue",
      permissions: manifest.options?.permissions ?? [],
      appBaseUrl: manifest.options?.appBaseUrl ?? "http://localhost:5173",
    }),
  );

  // .gitignore stays at the root: a pattern with a slash in the middle is anchored there.
  const gitignorePath = join(dir, ".gitignore");
  const gitignore = await readIfExists(gitignorePath);
  if (gitignore !== null) {
    const next = gitignore
      .split("\n")
      .map((l) => (l.trim() === "src/generated/" ? "**/src/generated/" : l));
    await writeFile(gitignorePath, next.join("\n"));
  }

  // One manifest per package, with paths relative to it. The root's own files (.gitignore,
  // README.md) leave the manifest: the root is yours.
  const rootOnly = new Set([".gitignore", "README.md"]);
  const hashAfter = async (path: string, entrySha: string, before: string | undefined) => {
    const now = await readIfExists(join(dir, path));
    // A file you had not edited stays "unedited" through the mechanical changes above.
    return before !== undefined && sha256(before) === entrySha && now !== null
      ? sha256(now)
      : entrySha;
  };
  const serverFiles = [];
  const clientFiles = [];
  for (const entry of manifest.files ?? []) {
    if (rootOnly.has(entry.path)) continue;
    if (entry.path.startsWith("web/")) {
      const path = entry.path.slice("web/".length);
      clientFiles.push({
        ...entry,
        path,
        sha256: await hashAfter(`client/${path}`, entry.sha256, original.get(entry.path)),
      });
    } else {
      serverFiles.push({
        ...entry,
        path: entry.path,
        sha256: await hashAfter(`server/${entry.path}`, entry.sha256, original.get(entry.path)),
      });
    }
  }
  const options = { ...manifest.options!, structure: WORKSPACE_STRUCTURE };
  await writeFile(
    join(dir, "server", MANIFEST_FILE),
    json(
      manifestSchema.parse({
        ...manifest,
        options: { ...options, layout: "server" },
        files: serverFiles,
      }),
    ),
  );
  await writeFile(
    join(dir, "client", MANIFEST_FILE),
    json(
      manifestSchema.parse({
        ...manifest,
        // The manifest requires a database; the client has none.
        database: { type: "memory", orm: "none" },
        ownedResources: { tables: [], types: [], migrations: [] },
        options: { ...options, layout: "client" },
        files: clientFiles,
      }),
    ),
  );
  await rm(join(dir, MANIFEST_FILE));
}
