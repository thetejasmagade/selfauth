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
  type InitAnswers,
} from "./render.js";
import { stackDependencies, stackFiles, templateSource, type TemplateSource } from "./templates.js";
import { CLI_VERSION } from "./version.js";

export interface PlannedFile {
  path: string;
  template: string;
  content: string;
}

export const sha256 = (content: string) => createHash("sha256").update(content, "utf8").digest("hex");

/** Every file `init` would create, in memory. Nothing is written. */
export async function planInit(answers: InitAnswers, source: TemplateSource = templateSource()): Promise<PlannedFile[]> {
  const files: PlannedFile[] = [];
  for (const entry of stackFiles(answers.database)) {
    if (entry.directory) {
      for (const rel of await source.listDirectory(entry.source)) {
        files.push({
          path: `${entry.target}/${rel}`,
          template: `express:${entry.source}/${rel}`,
          content: await source.read(`${entry.source}/${rel}`),
        });
      }
    } else {
      files.push({ path: entry.target, template: `express:${entry.source}`, content: await source.read(entry.source) });
    }
  }
  const deps = stackDependencies(answers.database);
  const ts = renderTsconfig();
  const config = buildConfig(answers);
  files.push(
    { path: "package.json", template: "rendered:package.json", content: renderPackageJson(answers, deps, await source.versions()) },
    { path: "tsconfig.json", template: "rendered:tsconfig", content: ts.base },
    { path: "tsconfig.build.json", template: "rendered:tsconfig.build", content: ts.build },
    { path: ".gitignore", template: "rendered:gitignore", content: renderGitignore() },
    { path: ".env.example", template: "rendered:env-example", content: renderEnvExample(answers) },
    { path: "README.md", template: "rendered:readme", content: renderReadme(answers) },
    { path: "src/selfauth.config.ts", template: "rendered:config", content: renderConfig(config) },
  );

  const owned = deps.manifest
    ? (JSON.parse(await source.read(deps.manifest)) as Manifest).ownedResources
    : { tables: [], types: [], migrations: [] };
  const manifest: Manifest = manifestSchema.parse({
    toolkit: "selfauth",
    version: CLI_VERSION,
    templateVersion: CLI_VERSION,
    specVersion: SPEC_VERSION,
    database: { type: answers.database, orm: answers.database === "postgresql" ? "prisma" : "none" },
    ownedResources: owned,
    files: files.map((f) => ({ path: f.path, template: f.template, sha256: sha256(f.content) })),
  });
  files.push({ path: "selfauth.manifest.json", template: "rendered:manifest", content: `${JSON.stringify(manifest, null, 2)}\n` });
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
