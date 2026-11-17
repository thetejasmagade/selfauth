import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { MANIFEST_FILE, manifestSchema, type Manifest } from "@selfauth/migration";
import { LAYOUT_STRUCTURE, sha256 } from "./plan.js";
import { flatLayoutMoves, hasFlatLayout } from "./project.js";

/**
 * `selfauth upgrade --reorganize`: moves a project made with SelfAuth ≤ 0.3 (app files side by
 * side in src/) into the grouped layout (src/config, src/email, src/db, src/http, src/routes),
 * rewrites the relative imports that point at moved files, and updates the manifest. Only paths
 * and import specifiers change; no file's logic is touched.
 */

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

export interface ReorganizePlan extends MovePlan {
  manifest: Manifest;
  scan: string[];
  mapping: Record<string, string>;
}

/** What `upgrade --reorganize` would do to a flat-layout project. Reads only. */
export async function planReorganize(
  dir: string,
): Promise<ReorganizePlan & { computed: Computed }> {
  const manifestPath = join(dir, MANIFEST_FILE);
  if (!existsSync(manifestPath))
    throw new Error("not a SelfAuth project (selfauth.manifest.json not found)");
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  if (!hasFlatLayout(manifest)) {
    throw new Error(
      "this project already uses the grouped layout; there is nothing to reorganize.",
    );
  }
  const add = manifest.options?.layout === "add";
  const srcDir = manifest.options?.srcDir ?? "src";
  const mapping = flatLayoutMoves({
    layout: manifest.options?.layout,
    srcDir,
    frontend: manifest.options?.frontend,
  });
  // Project layout: src/, test/ and the frontend's src. Add layout: the whole source folder,
  // because the application's own files may import from selfauth/.
  const scan = [
    add ? srcDir : "src",
    "test",
    ...(!add && (manifest.options?.frontend ?? "none") !== "none" ? ["web/src"] : []),
  ].map((d) => (d === "." ? "" : d));
  const computed = await planMoves(dir, mapping, scan);
  const problems = [...computed.problems];
  if (computed.moves.length === 0)
    problems.push(
      "none of the files to move were found; has the project been reorganized by hand?",
    );
  return {
    manifest,
    scan,
    mapping,
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
      const content = existsSync(join(dir, path)) ? await readFile(join(dir, path), "utf8") : null;
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
