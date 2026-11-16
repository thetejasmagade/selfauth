import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaMigrationAdapter } from "@selfauth/migration";
import { fileDrift, loadConfig, loadManifest } from "../project.js";
import { fail, info, ok, say } from "./output.js";

/** `selfauth validate`: configuration schema, generated-file integrity, and database schema/manifest. */
export async function validate(dirArg: string | undefined): Promise<number> {
  const dir = resolve(dirArg ?? ".");
  say(`SelfAuth validate → ${dir}`);
  const manifest = await loadManifest(dir);
  if (!manifest) {
    fail("not a SelfAuth project (selfauth.manifest.json not found)");
    return 1;
  }
  let errors = 0;

  const { errors: configErrors } = await loadConfig(dir);
  if (configErrors.length) {
    configErrors.forEach(fail);
    errors += configErrors.length;
  } else ok("src/selfauth.config.ts is valid");

  const drift = await fileDrift(dir, manifest);
  if (drift.missing.length) {
    drift.missing.forEach((m) => fail(`generated file missing: ${m}`));
    errors += drift.missing.length;
  }
  ok(`${drift.unchanged} generated file(s) unchanged`);
  if (drift.modified.length)
    info(`changed by you (kept, never overwritten): ${drift.modified.join(", ")}`);

  if (manifest.database.orm === "prisma") {
    if (existsSync(join(dir, "node_modules", ".bin", "prisma"))) {
      const report = await new PrismaMigrationAdapter({ cwd: dir }).validate();
      if (report.ok) ok("Prisma schema and ownership manifest are consistent");
      else {
        report.problems.forEach(fail);
        errors += report.problems.length;
      }
    } else info("Prisma not installed yet; run `npm install` to validate the database schema");
  }
  say(errors ? `\n${errors} problem(s).` : "\nAll checks passed.");
  return errors ? 1 : 0;
}
