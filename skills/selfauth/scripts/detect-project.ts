#!/usr/bin/env node
/* eslint-disable no-console -- command-line output for agents */
// Inspects a project for the selfauth skill: stack, database, existing authentication, and
// which SelfAuth command applies. Reads only; changes nothing.
//
//   node <skill>/scripts/detect-project.ts [project-dir] [--json]
import { resolve } from "node:path";
import { parseJson, positional, runCli } from "./cli.ts";

interface Option {
  command: string;
  available: boolean;
  blockers: string[];
  warnings: string[];
  tsconfigChanges?: Record<string, unknown>;
}
interface Report {
  cli: string;
  spec: string;
  dir: string;
  project: {
    hasPackageJson: boolean;
    framework: string | null;
    typescript: boolean;
    esm: boolean;
    packageManager: string | null;
    prisma: boolean;
    prismaProvider: string | null;
    databaseClients: string[];
    otherFrameworks: string[];
    otherLanguages: string[];
    existingAuth: string[];
    selfauth: boolean;
  };
  authSignals: { file: string; line: number; kind: string; text: string }[];
  layout: {
    entryFile: string | null;
    sourceDir: string;
    otherEntryFiles: string[];
    basis: string;
  } | null;
  workspaces: { dir: string; name: string | null; role: string; framework: string | null }[];
  frontend: { framework: string; options: Option[] } | null;
  recommendation: "init" | "add" | "add-frontend" | "workspace" | "upgrade" | "unsupported";
  reason: string;
  options: Option[];
}

const NEXT: Record<Report["recommendation"], string> = {
  init: "Present the plan with `selfauth init <dir> … --dry-run`, get approval, then run it with --yes (SKILL.md step 6).",
  add: "Show the existing-auth evidence (if any), present `selfauth add … --dry-run`, get approval, then run it with --yes (SKILL.md steps 3–6).",
  "add-frontend":
    "Present `selfauth add-frontend … --dry-run`, get approval, run it with --yes, then do the printed steps yourself: SelfAuth generates no pages (SKILL.md step 6 and references/project-layouts.md).",
  workspace:
    "This is a monorepo root. Run detect-project on each package listed below, then handle the backend with `add` and the frontend with `add-frontend`, one package at a time (references/project-layouts.md).",
  upgrade:
    "SelfAuth is installed: run `selfauth doctor` and `selfauth diff`; upgrade only with approval.",
  unsupported:
    "Stop. Tell the developer the stack is not supported and why; do not hand-write an adapter (SKILL.md rule 2).",
};

const argv = process.argv.slice(2);
const dir = resolve(positional(argv, [])[0] ?? ".");
const result = runCli(dir, ["detect", dir, "--json"]);
let report: Report;
try {
  report = parseJson<Report>(result, "selfauth detect");
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}

if (argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const p = report.project;
const yes = (b: boolean) => (b ? "yes" : "no");
const lines = [
  `# SelfAuth detection: ${report.dir}`,
  `CLI ${report.cli}, spec ${report.spec}`,
  "",
  `**Recommendation: ${report.recommendation}** — ${report.reason}`,
  "",
  `- Stack: framework ${p.framework ?? "none"}, TypeScript ${yes(p.typescript)}, ESM ${yes(p.esm)}, package manager ${p.packageManager ?? "unknown"}`,
  `- Database: ${[...p.databaseClients, ...(p.prisma ? [`prisma (${p.prismaProvider ?? "provider unknown"})`] : [])].join(", ") || "none found"}`,
];
if (p.otherFrameworks.length)
  lines.push(`- Unsupported frameworks: ${p.otherFrameworks.join(", ")}`);
if (p.otherLanguages.length) lines.push(`- Non-JavaScript backend: ${p.otherLanguages.join(", ")}`);
if (report.layout)
  lines.push(
    `- Source folder for \`add\`: \`${report.layout.sourceDir}\` (${report.layout.basis})${report.layout.otherEntryFiles.length ? `; other entry files: ${report.layout.otherEntryFiles.join(", ")}` : ""}`,
  );
if (report.workspaces.length)
  lines.push(
    "- Monorepo packages:",
    ...report.workspaces.map(
      (w) => `  - \`${w.dir}\`: ${w.role}${w.framework ? ` (${w.framework})` : ""}`,
    ),
  );
if (report.frontend) lines.push(`- Frontend: ${report.frontend.framework}`);
lines.push(`- Existing auth packages: ${p.existingAuth.join(", ") || "none"}`);
if (report.authSignals.length) {
  lines.push(
    "",
    "## Authentication code already in the application",
    "Show these to the developer and ask before changing anything (SKILL.md rule 4):",
    ...report.authSignals.map((s) => `- ${s.file}:${s.line} (${s.kind}): \`${s.text}\``),
  );
} else if (p.hasPackageJson) {
  lines.push("- No authentication code found in the application's source.");
}
const options = [...report.options, ...(report.frontend?.options ?? [])];
if (options.length) {
  lines.push("", "## Options");
  for (const o of options) {
    lines.push(`- ${o.available ? "available" : "BLOCKED"}: \`${o.command}\``);
    o.blockers.forEach((b) => lines.push(`  - blocker: ${b}`));
    o.warnings.forEach((w) => lines.push(`  - warning: ${w}`));
    if (o.tsconfigChanges && Object.keys(o.tsconfigChanges).length)
      lines.push(`  - tsconfig compilerOptions to add: \`${JSON.stringify(o.tsconfigChanges)}\``);
  }
}
lines.push("", `Next: ${NEXT[report.recommendation]}`);
console.log(lines.join("\n"));
