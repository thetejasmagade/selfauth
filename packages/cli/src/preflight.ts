import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type TypeScript from "typescript";
import { join } from "node:path";
import { detectProject, type ProjectInfo } from "./detect.js";
import { checkTsconfigCoverage } from "./layout.js";
import { normalizeSrcDir } from "./plan.js";
import type { Database } from "./templates.js";

/** Compiler options the generated code relies on (explicit `.ts` imports, rewritten on build). */
export const REQUIRED_COMPILER_OPTIONS = {
  allowImportingTsExtensions: true,
  rewriteRelativeImportExtensions: true,
} as const;

export interface Preflight {
  project: ProjectInfo;
  /** Folder SelfAuth will write under (`<srcDir>/selfauth/`). */
  srcDir: string;
  errors: string[];
  warnings: string[];
  /** Missing tsconfig compilerOptions, to be added by the developer. */
  tsconfigChanges: Record<string, unknown>;
}

type Options = Record<string, unknown>;

/** Effective compilerOptions, resolved with the project's own TypeScript when installed (follows `extends`). */
async function compilerOptions(
  dir: string,
): Promise<{ options: Options; resolved: boolean } | null> {
  const file = join(dir, "tsconfig.json");
  if (!existsSync(file)) return null;
  try {
    const require = createRequire(join(dir, "package.json"));
    const ts = require("typescript") as typeof TypeScript;
    const parsed = ts.getParsedCommandLineOfConfigFile(
      file,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => {},
      },
    );
    if (parsed) {
      const options = { ...parsed.options } as Options;
      // The API returns enums; report the module kind by name like tsconfig.json does.
      if (typeof options["module"] === "number")
        options["module"] = ts.ModuleKind[options["module"] as number];
      return { options, resolved: true };
    }
  } catch {
    // TypeScript not installed yet: fall back to reading the file itself.
  }
  const text = (await readFile(file, "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  const json = JSON.parse(text) as { compilerOptions?: Options };
  return { options: json.compilerOptions ?? {}, resolved: false };
}

/** The tsconfig's own JSON (comments and trailing commas tolerated), `extends` not followed. */
async function rawTsconfig(dir: string): Promise<Record<string, unknown> | null> {
  const file = join(dir, "tsconfig.json");
  if (!existsSync(file)) return null;
  const text = (await readFile(file, "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function majorMinor(range: string | undefined): [number, number] | null {
  const m = /(\d+)\.(\d+)/.exec(range ?? "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Can SelfAuth be added to this project? Reports blockers; changes nothing. */
export async function preflightAdd(
  dir: string,
  options: { database: Database; allowExistingAuth?: boolean; srcDir?: string },
): Promise<Preflight> {
  const project = await detectProject(dir);
  let srcDir = "src";
  const report: Preflight = { project, srcDir, errors: [], warnings: [], tsconfigChanges: {} };
  try {
    srcDir = normalizeSrcDir(options.srcDir ?? "src");
    report.srcDir = srcDir;
  } catch (error) {
    report.errors.push((error as Error).message);
  }
  if (project.selfauth)
    report.errors.push(
      "SelfAuth is already installed here (selfauth.manifest.json); use `selfauth upgrade`.",
    );
  if (!project.hasPackageJson) {
    report.errors.push("no package.json: use `selfauth init` for a new project.");
    return report;
  }
  const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
    type?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  if (project.framework !== "express")
    report.errors.push("Express is not a dependency: only Express projects are supported.");
  if (pkg.type !== "module")
    report.errors.push('package.json must have "type": "module" (the generated code is ESM).');
  const tsVersion = majorMinor({ ...pkg.dependencies, ...pkg.devDependencies }["typescript"]);
  if (!tsVersion) report.errors.push("TypeScript is not a dependency.");
  else if (tsVersion[0] < 5 || (tsVersion[0] === 5 && tsVersion[1] < 7)) {
    report.errors.push(
      `TypeScript ${tsVersion.join(".")} is too old: 5.7+ is needed for rewriteRelativeImportExtensions.`,
    );
  }
  if (project.existingAuth.length) {
    const msg = `existing authentication packages: ${project.existingAuth.join(", ")}. Running two auth systems side by side needs care`;
    if (options.allowExistingAuth) report.warnings.push(msg);
    else report.errors.push(`${msg}; re-run with --allow-existing-auth if that is intended.`);
  }
  if (options.database === "postgresql" && project.prisma) {
    report.errors.push(
      "this project already uses Prisma: merging SelfAuth's models into an existing schema is not automated yet. " +
        "Use --database memory to try SelfAuth, or copy the models from a project made with `selfauth init --database postgresql`.",
    );
  }

  const tsconfig = await compilerOptions(dir);
  if (!tsconfig) {
    report.errors.push("no tsconfig.json found.");
  } else {
    for (const [key, value] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
      if (tsconfig.options[key] !== value) report.tsconfigChanges[key] = value;
    }
    const module = String(tsconfig.options["module"] ?? "").toLowerCase();
    if (
      module &&
      !["nodenext", "node16", "node18", "node20", "esnext", "es2022", "preserve"].includes(module)
    ) {
      report.errors.push(
        `compilerOptions.module "${module}" is not an ES module target (use "NodeNext").`,
      );
    }
    if (!tsconfig.resolved)
      report.warnings.push(
        "TypeScript is not installed yet, so `extends` in tsconfig.json was not followed.",
      );
    const raw = await rawTsconfig(dir);
    if (raw && !report.errors.some((e) => e.includes("source folder"))) {
      const coverage = checkTsconfigCoverage(
        raw as Parameters<typeof checkTsconfigCoverage>[0],
        srcDir,
      );
      if (coverage.covered === false) report.errors.push(coverage.detail);
      else if (coverage.covered === null) report.warnings.push(coverage.detail);
    }
  }
  return report;
}

export interface FrontendPreflight {
  /** `vue` or `react`, as detected or requested. */
  frontend: "vue" | "react" | null;
  srcDir: string;
  errors: string[];
  warnings: string[];
  /** Packages the module needs that the project does not list yet. */
  missingPackages: string[];
  /** Missing tsconfig compilerOptions (type checking only; the bundler does not need them). */
  tsconfigChanges: Record<string, unknown>;
}

const FRONTEND_PACKAGES = {
  vue: ["vue", "vue-router"],
  react: ["react", "react-router"],
} as const;

/** Can the SelfAuth frontend module be added to this Vue or React app? Reports; changes nothing. */
export async function preflightAddFrontend(
  dir: string,
  options: { frontend?: string | undefined; srcDir?: string | undefined } = {},
): Promise<FrontendPreflight> {
  const report: FrontendPreflight = {
    frontend: null,
    srcDir: "src",
    errors: [],
    warnings: [],
    missingPackages: [],
    tsconfigChanges: {},
  };
  try {
    report.srcDir = normalizeSrcDir(options.srcDir ?? "src");
  } catch (error) {
    report.errors.push((error as Error).message);
  }
  if (existsSync(join(dir, "selfauth.manifest.json")))
    report.errors.push(
      "SelfAuth is already installed here (selfauth.manifest.json); use `selfauth upgrade`.",
    );
  if (!existsSync(join(dir, "package.json"))) {
    report.errors.push("no package.json: run this in your frontend project's folder.");
    return report;
  }
  const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  const present = (["vue", "react"] as const).filter((f) => f in deps);
  if (options.frontend && options.frontend !== "vue" && options.frontend !== "react") {
    report.errors.push(`unsupported frontend '${options.frontend}': only vue and react.`);
  } else if (options.frontend) {
    report.frontend = options.frontend as "vue" | "react";
    if (!(report.frontend in deps))
      report.errors.push(
        `--frontend ${report.frontend}, but "${report.frontend}" is not a dependency.`,
      );
  } else if (present.length === 1) {
    report.frontend = present[0]!;
  } else if (present.length > 1) {
    report.errors.push(
      "both vue and react are dependencies: pass --frontend vue or --frontend react.",
    );
  } else {
    report.errors.push(
      "no Vue or React dependency found: only Vue and React frontends are supported (Angular, Svelte, Next.js and others are not).",
    );
  }
  if (report.frontend) {
    report.missingPackages = FRONTEND_PACKAGES[report.frontend].filter((n) => !(n in deps));
  }
  if (!("typescript" in deps) && !existsSync(join(dir, "tsconfig.json")))
    report.warnings.push(
      "no TypeScript: the module is TypeScript. Vite and similar bundlers compile it, but nothing will type-check it.",
    );
  const tsconfig = await compilerOptions(dir);
  if (tsconfig && tsconfig.options["allowImportingTsExtensions"] !== true) {
    report.tsconfigChanges["allowImportingTsExtensions"] = true;
  }
  return report;
}
