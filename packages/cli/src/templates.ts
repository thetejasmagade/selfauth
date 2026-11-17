import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import registry from "./registry.json" with { type: "json" };

export type Database = "memory" | "postgresql";
export type Frontend = "none" | "vue" | "react";
export type Backend = "express" | "fastify";
export const BACKENDS: readonly Backend[] = ["express", "fastify"];

export interface Selection {
  /** The HTTP framework; Express when not given. */
  backend?: Backend;
  database: Database;
  frontend: Frontend;
  /** "add": integrating into an existing project (no app shell, no example routes). */
  layout?: "project" | "add";
}

export interface RegistryFile {
  source: string;
  target: string;
  when?: { database?: Database; frontend?: "none" | "any" };
  layout?: "project" | "add";
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

/** Package manifests whose tested versions generated projects inherit. */
export const VERSION_SOURCES = [
  "package.json",
  "apps/playground/package.json",
  "apps/playground-fastify/package.json",
  registry.frontends.vue.versionsFrom,
  registry.frontends.react.versionsFrom,
];

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out.sort();
}

function sourceAt(
  root: string,
  kind: TemplateSource["kind"],
  versions: () => Promise<Record<string, string>>,
): TemplateSource {
  return {
    kind,
    read: (source) => readFile(join(root, source), "utf8"),
    async listDirectory(source) {
      return (await listFiles(join(root, source))).map((f) =>
        relative(join(root, source), f).split("\\").join("/"),
      );
    },
    versions,
  };
}

async function repositoryVersions(): Promise<Record<string, string>> {
  const all: Record<string, string> = {};
  for (const p of VERSION_SOURCES) {
    const pkg = JSON.parse(await readFile(join(REPOSITORY, p), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    Object.assign(all, pkg.devDependencies, pkg.dependencies);
  }
  for (const [name, v] of Object.entries(all)) if (v.startsWith("workspace:")) delete all[name];
  return all;
}

export function templateSource(): TemplateSource {
  if (existsSync(join(BUNDLED, "versions.json"))) {
    return sourceAt(BUNDLED, "bundled", async () =>
      JSON.parse(await readFile(join(BUNDLED, "versions.json"), "utf8")),
    );
  }
  return sourceAt(REPOSITORY, "repository", repositoryVersions);
}

function applies(file: RegistryFile, sel: Selection): boolean {
  if (file.layout && file.layout !== (sel.layout ?? "project")) return false;
  const w = file.when;
  if (!w) return true;
  if (w.database && w.database !== sel.database) return false;
  if (w.frontend === "none" && sel.frontend !== "none") return false;
  if (w.frontend === "any" && sel.frontend === "none") return false;
  return true;
}

/** Backend files for a selection, plus the frontend's files under web/. */
export function stackFiles(sel: Selection): RegistryFile[] {
  const backend = (registry.stacks[sel.backend ?? "express"].files as RegistryFile[]).filter((f) =>
    applies(f, sel),
  );
  if (sel.frontend === "none") return backend;
  return [...backend, ...(registry.frontends[sel.frontend].files as RegistryFile[])];
}

/** The frontend's authentication module (web/src/auth/*): what `add-frontend` copies. */
export function frontendAuthFiles(frontend: "vue" | "react"): RegistryFile[] {
  return (registry.frontends[frontend].files as RegistryFile[]).filter(
    (f) => !f.directory && f.target.startsWith("web/src/auth/"),
  );
}

export function stackDependencies(
  database: Database,
  backend: Backend = "express",
): {
  dependencies: string[];
  devDependencies: string[];
  manifest?: string;
} {
  const stack = registry.stacks[backend];
  if (database !== "postgresql")
    return { dependencies: stack.dependencies, devDependencies: stack.devDependencies };
  return {
    dependencies: [...stack.dependencies, ...stack.postgresql.dependencies],
    devDependencies: [...stack.devDependencies, ...stack.postgresql.devDependencies],
    manifest: stack.postgresql.manifest,
  };
}

export function frontendInfo(frontend: Exclude<Frontend, "none">) {
  return registry.frontends[frontend];
}

export { registry };
