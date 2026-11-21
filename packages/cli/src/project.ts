import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MANIFEST_FILE, readManifest, type Manifest } from "@selfauth/migration";
import { parseConfig, type SelfAuthConfig } from "@selfauth/spec";
import { addLayoutPath, sha256 } from "./plan.js";

export interface FileDrift {
  modified: string[];
  missing: string[];
  unchanged: number;
}

export async function loadManifest(dir: string): Promise<Manifest | null> {
  const path = join(dir, MANIFEST_FILE);
  return existsSync(path) ? readManifest(path) : null;
}

/**
 * Where the app-shell files lived before structure 2 (SelfAuth ≤ 0.3 generated them side by side
 * in src/). Maps today's target to the old one, so projects made then keep working with
 * `doctor` and `validate`.
 */
export const FLAT_LAYOUT: Record<string, string> = {
  "src/config/env.ts": "src/env.ts",
  "src/config/selfauth.config.ts": "src/selfauth.config.ts",
  "src/config/dev-config.ts": "src/dev-config.ts",
  "src/email/mailer.ts": "src/mailer.ts",
  "src/db/store.ts": "src/store.ts",
  "src/http/errors.ts": "src/errors.ts",
  "src/http/request-id.ts": "src/request-id.ts",
  "src/routes/index.ts": "src/routes.ts",
  "src/routes/notes.ts": "src/example/notes.ts",
};

/** The five SelfAuth screens now live in web/src/pages/auth/; the app's own pages stay in pages/. */
const AUTH_PAGES = [
  "LoginPage",
  "RegisterPage",
  "VerifyEmailPage",
  "ForgotPasswordPage",
  "ResetPasswordPage",
];

/**
 * Every file the grouped layout moved, as old path → new path, for a project with these
 * options (project-relative). The frontend's pages are part of it: before structure 2 they sat
 * side by side in web/src/pages/.
 */
export function flatLayoutMoves(options: {
  layout?: string | undefined;
  srcDir?: string | undefined;
  frontend?: string | undefined;
}): Record<string, string> {
  const add = options.layout === "add";
  const rebase = (target: string) => (add ? addLayoutPath(target, options.srcDir) : target);
  const moves = Object.fromEntries(
    Object.entries(FLAT_LAYOUT).map(([grouped, flat]) => [rebase(flat), rebase(grouped)]),
  );
  const ext = options.frontend === "vue" ? "vue" : options.frontend === "react" ? "tsx" : null;
  if (ext && options.layout !== "add" && options.layout !== "frontend") {
    for (const page of AUTH_PAGES)
      moves[`web/src/pages/${page}.${ext}`] = `web/src/pages/auth/${page}.${ext}`;
  }
  return moves;
}

/** True for a project generated with the old flat src/ (no `structure` in its manifest). */
export function hasFlatLayout(manifest: Manifest | null): boolean {
  return (manifest?.options?.structure ?? 1) < 2 && manifest?.options?.layout !== "frontend";
}

/**
 * Where a generated file lives: `selfauth add` places src/ files under <src>/selfauth/, and
 * projects made with the old flat layout keep their old paths.
 */
export function projectPath(manifest: Manifest | null, target: string): string {
  if (isGoProject(manifest)) return GO_PATHS[target] ?? target;
  if (isPythonProject(manifest)) return PYTHON_PATHS[target] ?? target;
  const own = hasFlatLayout(manifest) ? (FLAT_LAYOUT[target] ?? target) : target;
  return manifest?.options?.layout === "add" ? addLayoutPath(own, manifest.options.srcDir) : own;
}

/** Where a Go (Gin) project keeps the file that implements `target`'s role. */
const GO_PATHS: Record<string, string> = {
  "src/config/selfauth.config.ts": "selfauth.config.json",
  "src/email/mailer.ts": "internal/email/mailer.go",
};

/** Where a Python (Flask) project keeps the file that implements `target`'s role. */
const PYTHON_PATHS: Record<string, string> = {
  "src/config/selfauth.config.ts": "selfauth.config.json",
  "src/email/mailer.ts": "app/mailer.py",
};

/** True for a Go project (its manifest says `backend: gin`). */
export const isGoProject = (manifest: Manifest | null): boolean =>
  manifest?.options?.backend === "gin";

/** True for a Python project (its manifest says `backend: flask`). */
export const isPythonProject = (manifest: Manifest | null): boolean =>
  manifest?.options?.backend === "flask";

/** True for a project that is not Node: its configuration is selfauth.config.json. */
export const isNativeProject = (manifest: Manifest | null): boolean =>
  isGoProject(manifest) || isPythonProject(manifest);

/** Imports the project's selfauth.config.ts (Node ≥ 22.18 runs TypeScript directly) and validates it. */
export async function loadConfig(
  dir: string,
  manifest: Manifest | null = null,
): Promise<{ config?: SelfAuthConfig; errors: string[] }> {
  if (isNativeProject(manifest)) return loadJsonConfig(dir);
  const relativePath = projectPath(manifest, "src/config/selfauth.config.ts");
  const path = join(dir, relativePath);
  if (!existsSync(path)) return { errors: [`${relativePath} not found`] };
  try {
    const mod = (await import(`${pathToFileURL(path).href}?t=${Date.now()}`)) as {
      config?: unknown;
    };
    return { config: parseConfig(mod.config), errors: [] };
  } catch (error) {
    const issues = (error as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    return {
      errors: issues
        ? issues.map((i) => `config ${i.path.join(".")}: ${i.message}`)
        : [`could not load ${relativePath}: ${(error as Error).message}`],
    };
  }
}

/** Reads and validates a Go project's selfauth.config.json. */
async function loadJsonConfig(dir: string): Promise<{ config?: SelfAuthConfig; errors: string[] }> {
  const file = "selfauth.config.json";
  const path = join(dir, file);
  if (!existsSync(path)) return { errors: [`${file} not found`] };
  try {
    return { config: parseConfig(JSON.parse(await readFile(path, "utf8"))), errors: [] };
  } catch (error) {
    const issues = (error as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    return {
      errors: issues
        ? issues.map((i) => `config ${i.path.join(".")}: ${i.message}`)
        : [`could not read ${file}: ${(error as Error).message}`],
    };
  }
}

/** Compares generated files with their recorded hashes (ADR 0004: ownership is metadata, not proof). */
export async function fileDrift(dir: string, manifest: Manifest): Promise<FileDrift> {
  const drift: FileDrift = { modified: [], missing: [], unchanged: 0 };
  for (const f of manifest.files ?? []) {
    if (f.path === MANIFEST_FILE) continue;
    const path = join(dir, f.path);
    if (!existsSync(path)) drift.missing.push(f.path);
    else if (sha256(await readFile(path, "utf8")) !== f.sha256) drift.modified.push(f.path);
    else drift.unchanged += 1;
  }
  return drift;
}

export function readEnvFile(dir: string, name: string): Promise<Record<string, string>> {
  const path = join(dir, name);
  if (!existsSync(path)) return Promise.resolve({});
  return readFile(path, "utf8").then((text) =>
    Object.fromEntries(
      text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    ),
  );
}

/**
 * The folders a command should act on. A folder with a manifest is itself. The root of a
 * full-stack project (no manifest, but server/ and/or client/ have one) means those packages.
 * A folder inside a package (server/src, ...) means the nearest ancestor with a manifest.
 * Otherwise the folder itself, so the command reports "not a SelfAuth project".
 */
export async function projectDirs(dirArg: string | undefined): Promise<string[]> {
  const dir = resolve(dirArg ?? ".");
  if (existsSync(join(dir, MANIFEST_FILE))) return [dir];
  const packages = ["server", "client"]
    .map((p) => join(dir, p))
    .filter((d) => existsSync(join(d, MANIFEST_FILE)));
  if (packages.length) return packages;
  let parent = dirname(dir);
  for (let i = 0; i < 4 && parent !== dirname(parent); i++, parent = dirname(parent)) {
    if (existsSync(join(parent, MANIFEST_FILE))) return [parent];
  }
  return [dir];
}

/** `server/: ` when a command covers several packages, empty for one. */
export function packageLabel(base: string, dirs: string[], dir: string): string {
  return dirs.length > 1 ? `${relative(resolve(base), dir) || "."}: ` : "";
}

/** The folder with the database tools: the server package of a full-stack project, else the folder. */
export async function databaseDir(dirArg: string | undefined): Promise<string> {
  const dirs = await projectDirs(dirArg);
  // Inside client/: the database tools live in its sibling server/.
  const sibling = dirs.length === 1 ? join(dirname(dirs[0]!), "server") : null;
  const candidates =
    sibling && dirs[0]!.endsWith("client") && existsSync(join(sibling, MANIFEST_FILE))
      ? [sibling]
      : dirs;
  for (const d of candidates) {
    const manifest = await loadManifest(d).catch(() => null);
    if (manifest && manifest.options?.layout !== "client" && manifest.database.orm !== "none")
      return d;
  }
  return candidates[0]!;
}
