import { relative, resolve } from "node:path";
import { SPEC_VERSION } from "@selfauth/spec";
import { findAuthSignals, type AuthSignal } from "../auth-signals.js";
import { detectProject, type ProjectInfo } from "../detect.js";
import {
  detectSourceLayout,
  findWorkspacePackages,
  type SourceLayout,
  type WorkspacePackage,
} from "../layout.js";
import { preflightAdd, preflightAddFrontend } from "../preflight.js";
import { projectDirs } from "../project.js";
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
  /** Where the backend app lives and which folder `add` would write under. Null if not a supported backend. */
  layout: SourceLayout | null;
  /** Packages of a monorepo (empty for a single package): run the command in the right one. */
  workspaces: WorkspacePackage[];
  /** Which Vue or React frontend this folder is, and whether `add-frontend` applies. */
  frontend: { framework: "vue" | "react"; options: CommandOption[] } | null;
  /**
   * What to do: `init` (new project), `add` (existing Express or Fastify project), `add-frontend`
   * (an existing Vue or React app), `workspace` (a monorepo root: run detect in a package),
   * `upgrade` (SelfAuth is already installed) or `unsupported` (stop and tell the developer).
   */
  recommendation: "init" | "add" | "add-frontend" | "workspace" | "upgrade" | "unsupported";
  /** Why, in one sentence. */
  reason: string;
  options: CommandOption[];
}

/** Inspects a directory and says which SelfAuth command (if any) applies. Reads only. */
export async function inspect(dirArg: string): Promise<DetectReport> {
  const dir = resolve(dirArg);
  const project = await detectProject(dir);
  const authSignals = project.exists && !project.empty ? await findAuthSignals(dir) : [];
  const workspaces = project.hasPackageJson ? await findWorkspacePackages(dir) : [];
  const backend = project.framework;
  const layout = backend ? await detectSourceLayout(dir, backend) : null;
  const base = {
    cli: CLI_VERSION,
    spec: SPEC_VERSION,
    dir,
    project,
    authSignals,
    layout,
    workspaces,
    frontend: null as DetectReport["frontend"],
  };

  // The root of a full-stack project has no manifest itself; its packages do.
  const installed = project.selfauth ? [] : await projectDirs(dir);
  if (installed.length > 0 && installed[0] !== dir) {
    const names = installed.map((d) => relative(dir, d) || ".").join(", ");
    return {
      ...base,
      recommendation: "upgrade",
      reason: `SelfAuth is already installed (${names}): check it with doctor/validate from this folder, update it with diff/upgrade.`,
      options: [
        { command: "selfauth doctor", available: true, blockers: [], warnings: [] },
        { command: "selfauth diff", available: true, blockers: [], warnings: [] },
      ],
    };
  }

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
      (l) => `this looks like a ${l} project; only Node.js with Express or Fastify is supported`,
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

  if (!backend && workspaces.length > 0) {
    const backends = workspaces.filter((w) => w.role === "backend");
    const frontends = workspaces.filter((w) => w.role === "frontend");
    const list = (ws: WorkspacePackage[]) => ws.map((w) => w.dir).join(", ") || "none";
    return {
      ...base,
      recommendation: "workspace",
      reason: `Monorepo root. Backend packages: ${list(backends)}. Frontend packages: ${list(frontends)}. Run \`selfauth detect <package>\` on each, then \`selfauth add <backend>\` and \`selfauth add-frontend <frontend>\`.`,
      options: [
        ...backends.map((w) => ({
          command: `selfauth add ${w.dir}`,
          available: true,
          blockers: [],
          warnings: [],
        })),
        ...frontends.map((w) => ({
          command: `selfauth add-frontend ${w.dir}`,
          available: true,
          blockers: [],
          warnings: [],
        })),
      ],
    };
  }

  if (!backend) {
    const web = await preflightAddFrontend(dir);
    if (web.frontend) {
      const blockers = [...web.errors];
      return {
        ...base,
        frontend: {
          framework: web.frontend,
          options: [
            {
              command: `selfauth add-frontend --frontend ${web.frontend}`,
              available: !blockers.length,
              blockers,
              warnings: [
                ...web.warnings,
                ...(web.missingPackages.length
                  ? [`install first: ${web.missingPackages.join(", ")}`]
                  : []),
              ],
              tsconfigChanges: web.tsconfigChanges,
            },
          ],
        },
        recommendation: blockers.length ? "unsupported" : "add-frontend",
        reason: blockers.length
          ? `A ${web.frontend} app, but \`selfauth add-frontend\` is blocked (see blockers).`
          : `A ${web.frontend} app: \`selfauth add-frontend\` writes the auth module under ${web.srcDir}/selfauth/ only. The API is a separate Express or Fastify project: run \`selfauth detect\` there.`,
        options: [],
      };
    }
    const found = project.otherFrameworks.length
      ? `found ${project.otherFrameworks.join(", ")}`
      : "no supported backend framework found";
    return {
      ...base,
      recommendation: "unsupported",
      reason: `Only Express and Fastify are supported (${found}). Do not hand-write an adapter.`,
      options: [],
    };
  }

  const options: CommandOption[] = [];
  for (const database of ["memory", "postgresql"] as const) {
    const check = await preflightAdd(dir, {
      database,
      backend,
      allowExistingAuth: true,
      srcDir: layout?.sourceDir ?? "src",
    });
    const blockers = [...check.errors];
    const warnings = [...check.warnings];
    if (project.existingAuth.length)
      warnings.push("needs --allow-existing-auth, and only with the developer's approval");
    options.push({
      command: `selfauth add --database ${database}${backend === "fastify" ? " --backend fastify" : ""}${layout && layout.sourceDir !== "src" ? ` --src ${layout.sourceDir}` : ""}${project.existingAuth.length ? " --allow-existing-auth" : ""}`,
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
      ? `Existing ${backend === "fastify" ? "Fastify" : "Express"} project: \`selfauth add\` writes new files under ${layout?.sourceDir === "." ? "" : `${layout?.sourceDir ?? "src"}/`}selfauth/ only.`
      : `Existing ${backend === "fastify" ? "Fastify" : "Express"} project, but \`selfauth add\` is blocked (see blockers).`,
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
  if (report.layout)
    info(
      `source folder: ${report.layout.sourceDir} (${report.layout.basis})${report.layout.otherEntryFiles.length ? `; other entry files: ${report.layout.otherEntryFiles.join(", ")}` : ""}`,
    );
  for (const w of report.workspaces)
    info(`package ${w.dir}: ${w.role}${w.framework ? ` (${w.framework})` : ""}`);
  if (report.frontend) info(`frontend: ${report.frontend.framework}`);
  if (p.existingAuth.length) warn(`existing auth packages: ${p.existingAuth.join(", ")}`);
  for (const s of report.authSignals) warn(`${s.kind}: ${s.file}:${s.line}  ${s.text}`);
  say(`\nRecommendation: ${report.recommendation} — ${report.reason}`);
  for (const o of [...report.options, ...(report.frontend?.options ?? [])]) {
    (o.available ? ok : fail)(o.command);
    o.blockers.forEach((b) => say(`      ✗ ${b}`));
    o.warnings.forEach((w) => say(`      ⚠ ${w}`));
    if (o.tsconfigChanges && Object.keys(o.tsconfigChanges).length)
      say(`      • tsconfig compilerOptions to add: ${JSON.stringify(o.tsconfigChanges)}`);
  }
  return 0;
}
