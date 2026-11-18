import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { manifestSchema, type Manifest } from "@selfauth/migration";
import { SPEC_VERSION } from "@selfauth/spec";
import {
  buildConfig,
  renderConfig,
  renderConfigJson,
  renderEnvExample,
  renderGoGitignore,
  isWorkspace,
  renderGitignore,
  renderPackageJson,
  renderReadme,
  renderRootPackageJson,
  renderTsconfig,
  renderWebPackageJson,
  renderWebTsconfig,
  type InitAnswers,
} from "./render.js";
import { BACKEND_DATABASES, type Backend } from "./templates.js";
import {
  frontendAuthFiles,
  frontendInfo,
  ormFor,
  registry,
  stackDependencies,
  stackFiles,
  templateSource,
  usesPrisma,
  type TemplateSource,
} from "./templates.js";
import { adaptForDialect, isDerivedDialect } from "./dialect.js";
import { GO_REFERENCE_MODULE } from "./templates.js";
import { isDemoFile, withoutNotesExample } from "./example.js";
import { trimTrailingSlashes } from "./layout.js";
import { CLI_VERSION } from "./version.js";

export interface PlannedFile {
  path: string;
  template: string;
  content: string;
}

/** Folder structure `init` (API only) and `add` generate (manifest `options.structure`). */
export const LAYOUT_STRUCTURE = 2;
/** Full-stack `init`: a workspace of two packages, server/ and client/ (each with a manifest). */
export const WORKSPACE_STRUCTURE = 3;

export const sha256 = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex");

/** Files copied from the reference implementations (template id `<stack>:<source path>`). */
export async function templateFiles(
  answers: Pick<InitAnswers, "database" | "frontend" | "backend" | "module">,
  source: TemplateSource,
  layout: "project" | "add" = "project",
  srcDir = "src",
  /**
   * `server`: the backend only. `client`: the frontend only, with paths relative to its own
   * package (web/ stripped). `all`: both, frontend under web/ (structures 1 and 2).
   */
  scope: "all" | "server" | "client" = "all",
): Promise<PlannedFile[]> {
  const files: PlannedFile[] = [];
  const place = (path: string): string | null => {
    const inWeb = path.startsWith("web/");
    if (scope === "server") return inWeb ? null : path;
    if (scope === "client") return inWeb ? path.slice("web/".length) : null;
    return path;
  };
  const rebase = layout === "add" ? (t: string) => addLayoutPath(t, srcDir) : (t: string) => t;
  const dialect =
    answers.backend !== "gin" && usesPrisma(answers.database) ? answers.database : null;
  const adapt = (target: string, content: string) => {
    if (answers.backend === "gin") return adaptForGo(target, content, answers.module);
    const derived = dialect ? adaptForDialect(dialect, target, content) : content;
    return layout === "add"
      ? adaptForAdd(target, derived, srcDir)
      : target.startsWith("web/")
        ? withoutNotesExample(target, derived)
        : derived;
  };
  const backend = answers.backend ?? "express";
  for (const entry of stackFiles({
    backend,
    database: answers.database,
    frontend: answers.frontend,
    layout,
  })) {
    const stack = entry.target.startsWith("web/") ? answers.frontend : backend;
    // A derived database has its own migration (generated from its schema, scripts/sync-dialects.mjs).
    const entrySource =
      dialect && isDerivedDialect(dialect) && entry.target === "prisma/migrations"
        ? registry.dialects[dialect].migrations
        : entry.source;
    if (entry.directory) {
      for (const rel of await source.listDirectory(entrySource)) {
        if (isDemoFile(`${entry.target}/${rel}`)) continue;
        const path = place(rebase(`${entry.target}/${rel}`));
        if (path === null) continue;
        files.push({
          path,
          template: `${stack}:${entrySource}/${rel}`,
          content: adapt(`${entry.target}/${rel}`, await source.read(`${entrySource}/${rel}`)),
        });
      }
    } else {
      const path = place(rebase(entry.target));
      if (path === null) continue;
      files.push({
        path,
        template: `${stack}:${entry.source}`,
        content: adapt(entry.target, await source.read(entry.source)),
      });
    }
  }
  return files;
}

/**
 * The one change a Go project needs from the reference application: its module path. The
 * reference is written with `example.com/app`; go.mod and every import of the application's own
 * packages use the project's module instead.
 */
export function adaptForGo(target: string, content: string, module: string | undefined): string {
  if (module === undefined || module === GO_REFERENCE_MODULE) return content;
  if (target === "go.mod") {
    const adapted = content.replace(`module ${GO_REFERENCE_MODULE}\n`, `module ${module}\n`);
    if (adapted === content) throw new Error("go.mod template changed: update adaptForGo()");
    return adapted;
  }
  return target.endsWith(".go")
    ? content.replaceAll(`"${GO_REFERENCE_MODULE}/`, `"${module}/`)
    : content;
}

/**
 * A source folder as the manifest and the CLI store it: relative, forward slashes, no `..`,
 * no trailing slash. `.` means the project root. Throws on anything that could escape the project.
 */
export function normalizeSrcDir(input: string): string {
  const cleaned = trimTrailingSlashes(input.trim().replaceAll("\\", "/").replace(/^\.\//, ""));
  if (cleaned === "" || cleaned === ".") return ".";
  if (cleaned.startsWith("/") || /^[A-Za-z]:/.test(cleaned) || cleaned.split("/").includes("..")) {
    throw new Error(`source folder '${input}' must be a relative path inside the project`);
  }
  if (cleaned.split("/").includes("node_modules") || cleaned.split("/").includes(".git")) {
    throw new Error(`source folder '${input}' must not be inside node_modules or .git`);
  }
  return cleaned;
}

/** Folder SelfAuth's files live in: `<srcDir>/selfauth`. */
export function selfauthRoot(srcDir = "src"): string {
  const dir = normalizeSrcDir(srcDir);
  return dir === "." ? "selfauth" : `${dir}/selfauth`;
}

/**
 * `selfauth add` puts SelfAuth's src/ files under `<srcDir>/selfauth/` (default `src/selfauth/`)
 * so nothing collides with the application's own files; other paths (prisma/) stay where tools
 * expect them.
 */
export function addLayoutPath(target: string, srcDir = "src"): string {
  return target.startsWith("src/")
    ? `${selfauthRoot(srcDir)}/${target.slice("src/".length)}`
    : target;
}

/** The one content change `add` needs: Prisma's client is generated next to the moved store. */
export function adaptForAdd(target: string, content: string, srcDir = "src"): string {
  if (target !== "prisma/schema.prisma") return content;
  const adapted = content.replace(
    'output              = "../src/generated/prisma"',
    `output              = "../${selfauthRoot(srcDir)}/generated/prisma"`,
  );
  if (adapted === content) throw new Error("schema.prisma template changed: update adaptForAdd()");
  return adapted;
}

export function buildManifest(
  answers: InitAnswers,
  files: PlannedFile[],
  owned: Manifest["ownedResources"],
  layout: "project" | "add" | "frontend" | "server" | "client" = "project",
  srcDir = "src",
  structure = LAYOUT_STRUCTURE,
): PlannedFile {
  const manifest: Manifest = manifestSchema.parse({
    toolkit: "selfauth",
    version: CLI_VERSION,
    templateVersion: CLI_VERSION,
    specVersion: SPEC_VERSION,
    database: {
      type: answers.database,
      orm: ormFor(answers.database, answers.backend),
    },
    ownedResources: owned,
    options: {
      layout,
      srcDir,
      structure,
      backend: answers.backend ?? "express",
      ...(answers.backend === "gin" && answers.module ? { module: answers.module } : {}),
      frontend: answers.frontend,
      permissions: answers.permissions,
      appBaseUrl: answers.appBaseUrl,
    },
    files: files.map((f) => ({ path: f.path, template: f.template, sha256: sha256(f.content) })),
  });
  return {
    path: "selfauth.manifest.json",
    template: "rendered:manifest",
    content: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}

export async function ownedResources(
  database: InitAnswers["database"],
  source: TemplateSource,
  backend: Backend = "express",
): Promise<Manifest["ownedResources"]> {
  // MongoDB: collections instead of tables; indexes, not migrations.
  if (database === "mongodb") {
    return { tables: [...registry.mongodb.collections], types: [], migrations: [] };
  }
  const manifestSource = stackDependencies(database, backend).manifest;
  if (!manifestSource) return { tables: [], types: [], migrations: [] };
  const owned = (JSON.parse(await source.read(manifestSource)) as Manifest).ownedResources;
  // The PostgreSQL manifest also lists its enum types; derived databases store enums as text.
  return isDerivedDialect(database) ? { ...owned, types: [] } : owned;
}

/** Every file `init` would create, in memory. Nothing is written. */
export async function planInit(
  answers: InitAnswers,
  source: TemplateSource = templateSource(),
): Promise<PlannedFile[]> {
  if (answers.backend === "gin") return planGin(answers, source);
  if (isWorkspace(answers)) return planWorkspace(answers, source);
  const files = await templateFiles(answers, source);
  const deps = stackDependencies(answers.database, answers.backend);
  const versions = await source.versions();
  const ts = renderTsconfig();
  files.push(
    {
      path: "package.json",
      template: "rendered:package.json",
      content: renderPackageJson(answers, deps, versions),
    },
    { path: "tsconfig.json", template: "rendered:tsconfig", content: ts.base },
    { path: "tsconfig.build.json", template: "rendered:tsconfig.build", content: ts.build },
    { path: ".gitignore", template: "rendered:gitignore", content: renderGitignore() },
    { path: ".env.example", template: "rendered:env-example", content: renderEnvExample(answers) },
    { path: "README.md", template: "rendered:readme", content: renderReadme(answers) },
    {
      path: "src/config/selfauth.config.ts",
      template: "rendered:config",
      content: renderConfig(buildConfig(answers)),
    },
  );
  files.push(
    buildManifest(answers, files, await ownedResources(answers.database, source, answers.backend)),
  );
  return files;
}

/**
 * A Go (Gin) project: the Go application copied from the reference, plus its configuration,
 * environment example, README, .gitignore and manifest. API only (no frontend), no package.json.
 */
async function planGin(answers: InitAnswers, source: TemplateSource): Promise<PlannedFile[]> {
  if (answers.frontend !== "none") {
    throw new Error("The Gin backend is API only for now: use --frontend none.");
  }
  if (!BACKEND_DATABASES.gin.includes(answers.database)) {
    throw new Error(
      `The Gin backend supports ${BACKEND_DATABASES.gin.join(" and ")} (got '${answers.database}').`,
    );
  }
  const module = answers.module ?? answers.name;
  const withModule = { ...answers, module };
  const files = await templateFiles(withModule, source);
  files.push(
    { path: ".gitignore", template: "rendered:gitignore", content: renderGoGitignore() },
    { path: ".env.example", template: "rendered:env-example", content: renderEnvExample(answers) },
    { path: "README.md", template: "rendered:readme", content: renderReadme(answers) },
    {
      path: "selfauth.config.json",
      template: "rendered:config",
      content: renderConfigJson(buildConfig(answers)),
    },
  );
  files.push(
    buildManifest(withModule, files, await ownedResources(answers.database, source, "gin")),
  );
  return files;
}

/**
 * A full-stack project (structure 3): a thin npm-workspace root, the API in server/ and the
 * frontend in client/. Each package has its own manifest, so `doctor`, `diff` and `upgrade` work
 * in it exactly as in any other package (manifest paths are relative to the package).
 */
async function planWorkspace(answers: InitAnswers, source: TemplateSource): Promise<PlannedFile[]> {
  const frontend = answers.frontend as Exclude<InitAnswers["frontend"], "none">;
  const versions = await source.versions();
  const ts = renderTsconfig();

  const server = await templateFiles(answers, source, "project", "src", "server");
  server.push(
    {
      path: "package.json",
      template: "rendered:package.json",
      content: renderPackageJson(
        answers,
        stackDependencies(answers.database, answers.backend),
        versions,
      ),
    },
    { path: "tsconfig.json", template: "rendered:tsconfig", content: ts.base },
    { path: "tsconfig.build.json", template: "rendered:tsconfig.build", content: ts.build },
    { path: ".env.example", template: "rendered:env-example", content: renderEnvExample(answers) },
    {
      path: "src/config/selfauth.config.ts",
      template: "rendered:config",
      content: renderConfig(buildConfig(answers)),
    },
  );
  const serverManifest = buildManifest(
    answers,
    server,
    await ownedResources(answers.database, source, answers.backend),
    "server",
    "src",
    WORKSPACE_STRUCTURE,
  );

  const client = await templateFiles(answers, source, "project", "src", "client");
  client.push(
    {
      path: "package.json",
      template: "rendered:web-package.json",
      content: renderWebPackageJson(answers, frontendInfo(frontend), versions),
    },
    {
      path: "tsconfig.json",
      template: "rendered:web-tsconfig",
      content: renderWebTsconfig(frontend),
    },
  );
  const clientManifest = buildManifest(
    // The manifest requires a database; the client has none.
    { ...answers, database: "memory" },
    client,
    { tables: [], types: [], migrations: [] },
    "client",
    "src",
    WORKSPACE_STRUCTURE,
  );

  const under = (dir: string, files: PlannedFile[]) =>
    files.map((f) => ({ ...f, path: `${dir}/${f.path}` }));
  return [
    ...under("server", [...server, serverManifest]),
    ...under("client", [...client, clientManifest]),
    {
      path: "package.json",
      template: "rendered:root-package.json",
      content: renderRootPackageJson(answers),
    },
    {
      path: ".gitignore",
      template: "rendered:gitignore",
      content: renderGitignore({ workspace: true }),
    },
    { path: "README.md", template: "rendered:readme", content: renderReadme(answers) },
  ];
}

export class ConflictError extends Error {
  override name = "ConflictError";
  constructor(readonly paths: string[]) {
    super(`refusing to overwrite existing files:\n  ${paths.join("\n  ")}`);
  }
}

/** Writes the plan. Never overwrites: checks first, then creates each file exclusively. */
export async function applyPlan(dir: string, files: PlannedFile[]): Promise<void> {
  const conflicts = files.filter((f) => existsSync(join(dir, f.path))).map((f) => f.path);
  if (conflicts.length > 0) throw new ConflictError(conflicts);
  for (const f of files) {
    const target = join(dir, f.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, f.content, { flag: "wx" });
  }
}

/** Every file `add` would create in an existing project (under `<srcDir>/selfauth/` and prisma/). */
export async function planAdd(
  answers: InitAnswers,
  source: TemplateSource = templateSource(),
  options: { srcDir?: string } = {},
): Promise<PlannedFile[]> {
  const srcDir = normalizeSrcDir(options.srcDir ?? "src");
  const files = await templateFiles(
    {
      database: answers.database,
      frontend: "none",
      ...(answers.backend ? { backend: answers.backend } : {}),
    },
    source,
    "add",
    srcDir,
  );
  files.push({
    path: addLayoutPath("src/config/selfauth.config.ts", srcDir),
    template: "rendered:config",
    content: renderConfig(buildConfig({ ...answers, frontend: "none" })),
  });
  files.push(
    buildManifest(
      { ...answers, frontend: "none" },
      files,
      await ownedResources(answers.database, source, answers.backend),
      "add",
      srcDir,
    ),
  );
  return files;
}

/**
 * The authentication module of a reference frontend (API client, session state, route guards,
 * `<Can>`, redirect and URL-token helpers), copied into an existing Vue or React app under
 * `<srcDir>/selfauth/`. The module imports nothing outside its own folder.
 */
export async function frontendAddFiles(
  frontend: "vue" | "react",
  source: TemplateSource,
  srcDir = "src",
): Promise<PlannedFile[]> {
  const root = selfauthRoot(srcDir);
  const files: PlannedFile[] = [];
  for (const entry of frontendAuthFiles(frontend)) {
    files.push({
      path: `${root}/${entry.target.slice("web/src/auth/".length)}`,
      template: `${frontend}:${entry.source}`,
      content: await source.read(entry.source),
    });
  }
  return files;
}

/** Every file `add-frontend` would create: the module plus its own manifest. Nothing is written. */
export async function planAddFrontend(
  options: { frontend: "vue" | "react"; srcDir?: string; appBaseUrl?: string },
  source: TemplateSource = templateSource(),
): Promise<PlannedFile[]> {
  const srcDir = normalizeSrcDir(options.srcDir ?? "src");
  const files = await frontendAddFiles(options.frontend, source, srcDir);
  files.push(
    buildManifest(
      {
        name: "frontend",
        // Not used by this layout: the manifest schema requires a database.
        database: "memory",
        frontend: options.frontend,
        permissions: [],
        appBaseUrl: options.appBaseUrl ?? "http://localhost:5173",
      },
      files,
      { tables: [], types: [], migrations: [] },
      "frontend",
      srcDir,
    ),
  );
  return files;
}
