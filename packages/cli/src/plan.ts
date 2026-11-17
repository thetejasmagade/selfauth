import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { manifestSchema, type Manifest } from "@selfauth/migration";
import { SPEC_VERSION } from "@selfauth/spec";
import {
  buildConfig,
  renderConfig,
  renderEnvExample,
  renderGitignore,
  renderPackageJson,
  renderReadme,
  renderTsconfig,
  renderWebPackageJson,
  renderWebTsconfig,
  type InitAnswers,
} from "./render.js";
import {
  frontendAuthFiles,
  frontendInfo,
  stackDependencies,
  stackFiles,
  templateSource,
  type TemplateSource,
} from "./templates.js";
import { trimTrailingSlashes } from "./layout.js";
import { CLI_VERSION } from "./version.js";

export interface PlannedFile {
  path: string;
  template: string;
  content: string;
}

export const sha256 = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex");

/** Files copied from the reference implementations (template id `<stack>:<source path>`). */
export async function templateFiles(
  answers: Pick<InitAnswers, "database" | "frontend">,
  source: TemplateSource,
  layout: "project" | "add" = "project",
  srcDir = "src",
): Promise<PlannedFile[]> {
  const files: PlannedFile[] = [];
  const rebase = layout === "add" ? (t: string) => addLayoutPath(t, srcDir) : (t: string) => t;
  const adapt = (target: string, content: string) =>
    layout === "add" ? adaptForAdd(target, content, srcDir) : content;
  for (const entry of stackFiles({
    database: answers.database,
    frontend: answers.frontend,
    layout,
  })) {
    const stack = entry.target.startsWith("web/") ? answers.frontend : "express";
    if (entry.directory) {
      for (const rel of await source.listDirectory(entry.source)) {
        files.push({
          path: rebase(`${entry.target}/${rel}`),
          template: `${stack}:${entry.source}/${rel}`,
          content: adapt(`${entry.target}/${rel}`, await source.read(`${entry.source}/${rel}`)),
        });
      }
    } else {
      files.push({
        path: rebase(entry.target),
        template: `${stack}:${entry.source}`,
        content: adapt(entry.target, await source.read(entry.source)),
      });
    }
  }
  return files;
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
  layout: "project" | "add" | "frontend" = "project",
  srcDir = "src",
): PlannedFile {
  const manifest: Manifest = manifestSchema.parse({
    toolkit: "selfauth",
    version: CLI_VERSION,
    templateVersion: CLI_VERSION,
    specVersion: SPEC_VERSION,
    database: {
      type: answers.database,
      orm: answers.database === "postgresql" ? "prisma" : "none",
    },
    ownedResources: owned,
    options: {
      layout,
      srcDir,
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
): Promise<Manifest["ownedResources"]> {
  const manifestSource = stackDependencies(database).manifest;
  return manifestSource
    ? (JSON.parse(await source.read(manifestSource)) as Manifest).ownedResources
    : { tables: [], types: [], migrations: [] };
}

/** Every file `init` would create, in memory. Nothing is written. */
export async function planInit(
  answers: InitAnswers,
  source: TemplateSource = templateSource(),
): Promise<PlannedFile[]> {
  const files = await templateFiles(answers, source);
  const deps = stackDependencies(answers.database);
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
      path: "src/selfauth.config.ts",
      template: "rendered:config",
      content: renderConfig(buildConfig(answers)),
    },
  );
  if (answers.frontend !== "none") {
    const info = frontendInfo(answers.frontend);
    files.push(
      {
        path: "web/package.json",
        template: "rendered:web-package.json",
        content: renderWebPackageJson(answers, info, versions),
      },
      {
        path: "web/tsconfig.json",
        template: "rendered:web-tsconfig",
        content: renderWebTsconfig(answers.frontend),
      },
    );
  }
  files.push(buildManifest(answers, files, await ownedResources(answers.database, source)));
  return files;
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
    { database: answers.database, frontend: "none" },
    source,
    "add",
    srcDir,
  );
  files.push({
    path: addLayoutPath("src/selfauth.config.ts", srcDir),
    template: "rendered:config",
    content: renderConfig(buildConfig({ ...answers, frontend: "none" })),
  });
  files.push(
    buildManifest(
      { ...answers, frontend: "none" },
      files,
      await ownedResources(answers.database, source),
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
