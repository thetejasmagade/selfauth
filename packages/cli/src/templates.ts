import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import registry from "./registry.json" with { type: "json" };

export type Database = "memory" | "postgresql";

export interface RegistryFile {
  source: string;
  target: string;
  when?: Database;
  directory?: boolean;
}

/** Where template sources come from: bundled into the package, or the SelfAuth repository (development). */
export interface TemplateSource {
  kind: "bundled" | "repository";
  read(source: string): Promise<string>;
  listDirectory(source: string): Promise<string[]>;
  /** Dependency name → version range used by the reference implementations. */
  versions(): Promise<Record<string, string>>;
}

const BUNDLED = fileURLToPath(new URL("./templates/", import.meta.url));
const REPOSITORY = fileURLToPath(new URL("../../../", import.meta.url));

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out.sort();
}

function sourceAt(root: string, kind: TemplateSource["kind"], versions: () => Promise<Record<string, string>>): TemplateSource {
  return {
    kind,
    read: (source) => readFile(join(root, source), "utf8"),
    async listDirectory(source) {
      return (await listFiles(join(root, source))).map((f) => relative(join(root, source), f).split("\\").join("/"));
    },
    versions,
  };
}

/** Versions declared by the reference apps: the generated project gets exactly what was tested. */
async function repositoryVersions(): Promise<Record<string, string>> {
  const pkgs = ["package.json", "apps/playground/package.json"].map(async (p) =>
    JSON.parse(await readFile(join(REPOSITORY, p), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    },
  );
  const all: Record<string, string> = {};
  for (const pkg of await Promise.all(pkgs)) Object.assign(all, pkg.devDependencies, pkg.dependencies);
  return all;
}

export function templateSource(): TemplateSource {
  if (existsSync(join(BUNDLED, "versions.json"))) {
    return sourceAt(BUNDLED, "bundled", async () => JSON.parse(await readFile(join(BUNDLED, "versions.json"), "utf8")));
  }
  return sourceAt(REPOSITORY, "repository", repositoryVersions);
}

export function stackFiles(database: Database): RegistryFile[] {
  return (registry.stacks.express.files as RegistryFile[]).filter((f) => !f.when || f.when === database);
}

export function stackDependencies(database: Database): { dependencies: string[]; devDependencies: string[]; manifest?: string } {
  const express = registry.stacks.express;
  if (database !== "postgresql") return { dependencies: express.dependencies, devDependencies: express.devDependencies };
  return {
    dependencies: [...express.dependencies, ...express.postgresql.dependencies],
    devDependencies: [...express.devDependencies, ...express.postgresql.devDependencies],
    manifest: express.postgresql.manifest,
  };
}

export { registry };
