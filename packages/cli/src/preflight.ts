import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type TypeScript from "typescript";
import { join } from "node:path";
import { detectProject, type ProjectInfo } from "./detect.js";
import type { Database } from "./templates.js";

/** Compiler options the generated code relies on (explicit `.ts` imports, rewritten on build). */
export const REQUIRED_COMPILER_OPTIONS = {
  allowImportingTsExtensions: true,
  rewriteRelativeImportExtensions: true,
} as const;

export interface Preflight {
  project: ProjectInfo;
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

function majorMinor(range: string | undefined): [number, number] | null {
  const m = /(\d+)\.(\d+)/.exec(range ?? "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Can SelfAuth be added to this project? Reports blockers; changes nothing. */
export async function preflightAdd(
  dir: string,
  options: { database: Database; allowExistingAuth?: boolean },
): Promise<Preflight> {
  const project = await detectProject(dir);
  const report: Preflight = { project, errors: [], warnings: [], tsconfigChanges: {} };
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
  }
  return report;
}
