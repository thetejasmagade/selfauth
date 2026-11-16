import { resolve } from "node:path";
import { SPEC_VERSION } from "@selfauth/spec";
import { findAuthSignals, type AuthSignal } from "../auth-signals.js";
import { detectProject, type ProjectInfo } from "../detect.js";
import { preflightAdd } from "../preflight.js";
import { CLI_VERSION } from "../version.js";
import { fail, info, ok, say, warn } from "./output.js";

export interface CommandOption {
  /** The command to run first with `--dry-run` to show the developer the plan. */
  command: string;
  available: boolean;
  blockers: string[];
  warnings: string[];
  /** tsconfig compilerOptions the developer must add (`add` only). */
  tsconfigChanges?: Record<string, unknown>;
}

export interface DetectReport {
  cli: string;
  spec: string;
  dir: string;
  project: ProjectInfo;
  /** file:line evidence of hand-written authentication in the application's source. */
  authSignals: AuthSignal[];
  /**
   * What to do: `init` (new project), `add` (existing Express project), `upgrade`
   * (SelfAuth is already installed) or `unsupported` (stop and tell the developer).
   */
  recommendation: "init" | "add" | "upgrade" | "unsupported";
  /** Why, in one sentence. */
  reason: string;
  options: CommandOption[];
}

/** Inspects a directory and says which SelfAuth command (if any) applies. Reads only. */
export async function inspect(dirArg: string): Promise<DetectReport> {
  const dir = resolve(dirArg);
  const project = await detectProject(dir);
  const authSignals = project.exists && !project.empty ? await findAuthSignals(dir) : [];
  const base = { cli: CLI_VERSION, spec: SPEC_VERSION, dir, project, authSignals };

  if (project.selfauth) {
    return {
      ...base,
      recommendation: "upgrade",
      reason:
        "SelfAuth is already installed (selfauth.manifest.json): check it with doctor/validate, update it with diff/upgrade.",
      options: [
        { command: "selfauth doctor", available: true, blockers: [], warnings: [] },
        { command: "selfauth diff", available: true, blockers: [], warnings: [] },
      ],
    };
  }

  if (!project.hasPackageJson) {
    const blockers = project.otherLanguages.map(
      (l) => `this looks like a ${l} project; only Node.js + Express is supported`,
    );
    return {
      ...base,
      recommendation: blockers.length ? "unsupported" : "init",
      reason: blockers.length
        ? `No generator for ${project.otherLanguages.join(", ")} backends.`
        : "No package.json: generate a new project.",
      options: ["postgresql", "memory"].map((db) => ({
        command: `selfauth init <dir> --database ${db} --frontend none|vue|react`,
        available: !blockers.length,
        blockers,
        warnings: [],
      })),
    };
  }

  if (project.framework !== "express") {
    const found = project.otherFrameworks.length
      ? `found ${project.otherFrameworks.join(", ")}`
      : "no supported backend framework found";
    return {
      ...base,
      recommendation: "unsupported",
      reason: `Only Express is supported (${found}). Do not hand-write an adapter.`,
      options: [],
    };
  }

  const options: CommandOption[] = [];
  for (const database of ["memory", "postgresql"] as const) {
    const check = await preflightAdd(dir, { database, allowExistingAuth: true });
    const blockers = [...check.errors];
    const warnings = [...check.warnings];
    if (project.existingAuth.length)
      warnings.push("needs --allow-existing-auth, and only with the developer's approval");
    options.push({
      command: `selfauth add --database ${database}${project.existingAuth.length ? " --allow-existing-auth" : ""}`,
      available: !blockers.length,
      blockers,
      warnings,
      tsconfigChanges: check.tsconfigChanges,
    });
  }
  const any = options.some((o) => o.available);
  return {
    ...base,
    recommendation: any ? "add" : "unsupported",
    reason: any
      ? "Existing Express project: `selfauth add` writes new files under src/selfauth/ only."
      : "Existing Express project, but `selfauth add` is blocked (see blockers).",
    options,
  };
}

export async function detect(
  dirArg: string | undefined,
  opts: { json?: boolean } = {},
): Promise<number> {
  const report = await inspect(dirArg ?? ".");
  if (opts.json) {
    say(JSON.stringify(report, null, 2));
    return 0;
  }
  const p = report.project;
  say(`SelfAuth detect → ${report.dir}`);
  info(
    `package.json: ${p.hasPackageJson ? "yes" : "no"}, framework: ${p.framework ?? "none"}, TypeScript: ${p.typescript ? "yes" : "no"}, ESM: ${p.esm ? "yes" : "no"}, package manager: ${p.packageManager ?? "unknown"}`,
  );
  if (p.otherFrameworks.length) warn(`unsupported frameworks: ${p.otherFrameworks.join(", ")}`);
  if (p.otherLanguages.length) warn(`non-JavaScript backend: ${p.otherLanguages.join(", ")}`);
  info(
    `database: ${[...p.databaseClients, ...(p.prisma ? [`prisma (${p.prismaProvider ?? "?"})`] : [])].join(", ") || "none found"}`,
  );
  if (p.existingAuth.length) warn(`existing auth packages: ${p.existingAuth.join(", ")}`);
  for (const s of report.authSignals) warn(`${s.kind}: ${s.file}:${s.line}  ${s.text}`);
  say(`\nRecommendation: ${report.recommendation} — ${report.reason}`);
  for (const o of report.options) {
    (o.available ? ok : fail)(o.command);
    o.blockers.forEach((b) => say(`      ✗ ${b}`));
    o.warnings.forEach((w) => say(`      ⚠ ${w}`));
    if (o.tsconfigChanges && Object.keys(o.tsconfigChanges).length)
      say(`      • tsconfig compilerOptions to add: ${JSON.stringify(o.tsconfigChanges)}`);
  }
  return 0;
}
