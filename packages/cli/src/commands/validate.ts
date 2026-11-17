import { resolve } from "node:path";
import { findLocalPrisma, PrismaMigrationAdapter } from "@selfauth/migration";
import { fileDrift, loadConfig, loadManifest, packageLabel, projectDirs } from "../project.js";
import { fail, info, ok, say } from "./output.js";

export interface ValidationReport {
  ok: boolean;
  /** Failed checks. Empty when ok. */
  problems: string[];
  /** Passed checks and information (files you changed, steps skipped). */
  passed: string[];
  notes: string[];
}

/** Configuration schema, generated-file integrity, and database schema/manifest. Reads only. */
export async function runValidation(dir: string): Promise<ValidationReport> {
  const r: ValidationReport = { ok: false, problems: [], passed: [], notes: [] };
  const manifest = await loadManifest(dir).catch((e: Error) => {
    r.problems.push(`selfauth.manifest.json is invalid: ${e.message}`);
    return null;
  });
  if (!manifest) {
    if (!r.problems.length)
      r.problems.push("not a SelfAuth project (selfauth.manifest.json not found)");
    return r;
  }

  if (manifest.options?.layout === "frontend" || manifest.options?.layout === "client") {
    // The frontend module has no configuration or database: check its files only.
    const drift = await fileDrift(dir, manifest);
    r.problems.push(...drift.missing.map((m) => `generated file missing: ${m}`));
    r.passed.push(`${drift.unchanged} generated file(s) unchanged`);
    if (drift.modified.length)
      r.notes.push(`changed by you (kept, never overwritten): ${drift.modified.join(", ")}`);
    r.ok = r.problems.length === 0;
    return r;
  }

  const { errors: configErrors } = await loadConfig(dir, manifest);
  if (configErrors.length) r.problems.push(...configErrors);
  else r.passed.push("selfauth configuration is valid");

  const drift = await fileDrift(dir, manifest);
  r.problems.push(...drift.missing.map((m) => `generated file missing: ${m}`));
  r.passed.push(`${drift.unchanged} generated file(s) unchanged`);
  if (drift.modified.length)
    r.notes.push(`changed by you (kept, never overwritten): ${drift.modified.join(", ")}`);

  if (manifest.database.orm === "prisma") {
    // In an npm workspace the binary is hoisted to the workspace root.
    if (findLocalPrisma(dir)) {
      const report = await new PrismaMigrationAdapter({ cwd: dir }).validate();
      if (report.ok) r.passed.push("Prisma schema and ownership manifest are consistent");
      else r.problems.push(...report.problems);
    } else {
      // Not a pass: the schema was not checked. Reported so nobody claims it was.
      r.problems.push(
        "Prisma is not installed, so the database schema was not validated (run `npm install`)",
      );
    }
  }
  r.ok = r.problems.length === 0;
  return r;
}

/** `selfauth validate`. A full-stack project's root validates its packages and merges the results. */
export async function validate(
  dirArg: string | undefined,
  opts: { json?: boolean } = {},
): Promise<number> {
  const base = resolve(dirArg ?? ".");
  const dirs = await projectDirs(dirArg);
  const r: ValidationReport = { ok: true, problems: [], passed: [], notes: [] };
  for (const dir of dirs) {
    const one = await runValidation(dir);
    const prefix = packageLabel(base, dirs, dir);
    r.ok &&= one.ok;
    r.problems.push(...one.problems.map((m) => prefix + m));
    r.passed.push(...one.passed.map((m) => prefix + m));
    r.notes.push(...one.notes.map((m) => prefix + m));
  }
  if (opts.json) {
    say(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }
  say(`SelfAuth validate → ${base}`);
  r.passed.forEach(ok);
  r.problems.forEach(fail);
  r.notes.forEach(info);
  say(r.ok ? "\nAll checks passed." : `\n${r.problems.length} problem(s).`);
  return r.ok ? 0 : 1;
}
