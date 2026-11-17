import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * Where things live in an existing project. SelfAuth never assumes `src/`: it looks for the
 * Express entry file, suggests a source folder from it, and reports monorepo packages, so the
 * developer (or their agent) can pass `--src` or run in the right package.
 */

const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  "generated",
  "selfauth",
]);
const SOURCE = /\.(?:[cm]?[jt]s)$/;
const MAX_DEPTH = 4;
const MAX_FILES = 1500;
/** Names an Express entry file usually has; used only to break ties. */
const ENTRY_NAMES = ["server", "app", "index", "main"];

async function files(dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (out.length >= MAX_FILES) break;
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await files(full, depth + 1, out);
    else if (SOURCE.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const posix = (p: string) => p.split("\\").join("/");

/** Removes trailing slashes in linear time (a `/\/+$/` regex is quadratic on long runs of `/`). */
export function trimTrailingSlashes(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === "/") end--;
  return text.slice(0, end);
}

/** Files that create an Express application, as paths relative to `dir`, best candidate first. */
export async function findExpressEntryFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const file of await files(dir)) {
    const text = await readFile(file, "utf8").catch(() => "");
    if (
      /from\s+["']express["']|require\(\s*["']express["']\s*\)/.test(text) &&
      /\bexpress\(\s*\)/.test(text)
    ) {
      found.push(posix(relative(dir, file)));
    }
  }
  const rank = (path: string) => {
    const base = path
      .split("/")
      .pop()!
      .replace(/\.[^.]+$/, "");
    const named = ENTRY_NAMES.indexOf(base);
    // Shallower, then conventionally named, then alphabetical.
    return [path.split("/").length, named < 0 ? 99 : named, path] as const;
  };
  return found.sort((a, b) => {
    const [da, na, pa] = rank(a);
    const [db, nb, pb] = rank(b);
    return da - db || na - nb || pa.localeCompare(pb);
  });
}

/**
 * The folder SelfAuth should write under (`<folder>/selfauth/`), from the entry file:
 * `src/**` → `src`; `<x>/src/**` → `<x>/src`; `<x>/...` → `<x>`; a file at the root → `.`.
 */
export function suggestSourceDir(entryFile: string): string {
  const parts = entryFile.split("/");
  if (parts.length === 1) return ".";
  const src = parts.indexOf("src");
  if (src >= 0) return parts.slice(0, src + 1).join("/");
  return parts[0]!;
}

export interface SourceLayout {
  /** The Express entry file, relative to the project, when one was found. */
  entryFile: string | null;
  /** Folder to pass to `--src`. `src` when it exists and holds the entry, or no entry was found. */
  sourceDir: string;
  /** Other candidates when more than one Express entry file exists. */
  otherEntryFiles: string[];
  /** How `sourceDir` was chosen, for the developer. */
  basis: string;
}

export async function detectSourceLayout(dir: string): Promise<SourceLayout> {
  const entries = await findExpressEntryFiles(dir);
  const entryFile = entries[0] ?? null;
  if (!entryFile) {
    return {
      entryFile: null,
      sourceDir: "src",
      otherEntryFiles: [],
      basis: existsSync(join(dir, "src"))
        ? "no Express entry file found; src/ exists"
        : "no Express entry file found; defaulting to src/ (pass --src if the code lives elsewhere)",
    };
  }
  return {
    entryFile,
    sourceDir: suggestSourceDir(entryFile),
    otherEntryFiles: entries.slice(1, 6),
    basis: `Express app created in ${entryFile}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Workspaces (monorepos)
// ---------------------------------------------------------------------------------------------

export interface WorkspacePackage {
  /** Path relative to the repository root. */
  dir: string;
  name: string | null;
  role: "backend" | "frontend" | "other";
  /** `express`, `vue` or `react` when recognised. */
  framework: string | null;
}

async function workspacePatterns(dir: string): Promise<string[]> {
  const patterns: string[] = [];
  const pkgFile = join(dir, "package.json");
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(await readFile(pkgFile, "utf8")) as {
      workspaces?: string[] | { packages?: string[] };
    };
    const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages ?? []);
    patterns.push(...ws);
  }
  const pnpm = join(dir, "pnpm-workspace.yaml");
  if (existsSync(pnpm)) {
    // Only the `packages:` list matters; a full YAML parser is not worth a dependency here.
    let inList = false;
    for (const line of (await readFile(pnpm, "utf8")).split("\n")) {
      if (/^packages\s*:/.test(line)) inList = true;
      else if (inList && /^\s*-\s*/.test(line))
        patterns.push(
          line
            .replace(/^\s*-\s*/, "")
            .replace(/["']/g, "")
            .trim(),
        );
      else if (inList && /^\S/.test(line)) inList = false;
    }
  }
  return patterns.filter((p) => !p.startsWith("!"));
}

/** Expands `apps/*`, `packages/**` and plain paths to directories that hold a package.json. */
async function expand(dir: string, pattern: string): Promise<string[]> {
  const clean = trimTrailingSlashes(pattern.replace(/^\.\//, ""));
  const star = clean.search(/[*?{[]/);
  if (star < 0) return existsSync(join(dir, clean, "package.json")) ? [clean] : [];
  const base = trimTrailingSlashes(clean.slice(0, star));
  const deep = clean.includes("**");
  const out: string[] = [];
  const walk = async (rel: string, depth: number) => {
    const abs = join(dir, rel);
    if (!existsSync(abs)) return;
    for (const entry of await readdir(abs, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (existsSync(join(dir, child, "package.json"))) out.push(child);
      if (deep && depth < 3) await walk(child, depth + 1);
    }
  };
  await walk(base, 0);
  return out;
}

/** Packages of a monorepo, with what each one is. Empty for a single-package project. */
export async function findWorkspacePackages(dir: string): Promise<WorkspacePackage[]> {
  const found = new Set<string>();
  for (const pattern of await workspacePatterns(dir)) {
    for (const d of await expand(dir, pattern)) found.add(d);
  }
  const packages: WorkspacePackage[] = [];
  for (const d of [...found].sort()) {
    const pkg = JSON.parse(await readFile(join(dir, d, "package.json"), "utf8")) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const framework =
      "express" in deps ? "express" : "vue" in deps ? "vue" : "react" in deps ? "react" : null;
    packages.push({
      dir: d,
      name: pkg.name ?? null,
      role: framework === "express" ? "backend" : framework ? "frontend" : "other",
      framework,
    });
  }
  return packages;
}

// ---------------------------------------------------------------------------------------------
// tsconfig coverage
// ---------------------------------------------------------------------------------------------

export interface CoverageResult {
  /** `true`: covered. `false`: certainly not. `null`: could not tell (reported as a warning). */
  covered: boolean | null;
  detail: string;
}

/** The folder a tsconfig glob starts in: `src/**\/*.ts` → `src`, `**\/*` → `` (everything). */
function globBase(pattern: string): string {
  const clean = posix(pattern).replace(/^\.\//, "");
  const star = clean.search(/[*?{[]/);
  const base = star < 0 ? clean : clean.slice(0, star);
  // `src` (a folder) and `src/main.ts` (a file) both start in `src`.
  const folder =
    star < 0 && /\.[cm]?[jt]sx?$/.test(clean) ? clean.split("/").slice(0, -1).join("/") : base;
  return trimTrailingSlashes(folder);
}

const within = (path: string, base: string) =>
  base === "" || base === "." || path === base || path.startsWith(`${base}/`);

/**
 * Does the project's tsconfig compile `<srcDir>/selfauth/`? Checks `include`, `files`, `exclude`
 * and `rootDir` from the file's own text; reports `null` when `extends` hides the answer.
 */
export function checkTsconfigCoverage(
  config: {
    include?: string[];
    files?: string[];
    exclude?: string[];
    extends?: unknown;
    compilerOptions?: { rootDir?: string };
  },
  srcDir: string,
): CoverageResult {
  const target = srcDir === "." ? "selfauth" : `${posix(srcDir)}/selfauth`;
  const rootDir = config.compilerOptions?.rootDir;
  if (rootDir !== undefined) {
    const root = trimTrailingSlashes(posix(rootDir).replace(/^\.\//, ""));
    if (!within(target, root === "." ? "" : root)) {
      return {
        covered: false,
        detail: `compilerOptions.rootDir is "${rootDir}" but SelfAuth's files go in ${target}/: widen rootDir to include it`,
      };
    }
  }
  for (const pattern of config.exclude ?? []) {
    if (within(target, globBase(pattern)) && globBase(pattern) !== "") {
      return {
        covered: false,
        detail: `tsconfig "exclude" contains "${pattern}", which covers ${target}/`,
      };
    }
  }
  if (config.include) {
    const ok = config.include.some((p) => within(target, globBase(p)));
    return ok
      ? { covered: true, detail: `"include" covers ${target}/` }
      : {
          covered: false,
          detail: `tsconfig "include" (${config.include.join(", ")}) does not cover ${target}/: add "${srcDir === "." ? "**/*" : srcDir}"`,
        };
  }
  if (config.files) {
    return {
      covered: false,
      detail: `tsconfig lists "files" only; add ${target}/**/*.ts to "include"`,
    };
  }
  if (config.extends !== undefined) {
    return {
      covered: null,
      detail: `tsconfig extends another file, so "include" was not checked: make sure ${target}/ is compiled`,
    };
  }
  return { covered: true, detail: "no include list: every file is compiled" };
}
