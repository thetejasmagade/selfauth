import { PrismaMigrationAdapter, type MigrationPlan } from "@selfauth/migration";
import { databaseDir, loadManifest } from "../project.js";
import { fail, info, ok, say, warn } from "./output.js";

function printPlan(plan: MigrationPlan) {
  if (plan.pending.length === 0) return ok("No pending migrations.");
  say(`Pending migrations (${plan.pending.length}):`);
  for (const m of plan.pending) say(`  • ${m.name}  (${m.path})`);
  if (plan.findings.length === 0) return ok("No destructive or non-owned changes.");
  say("\nChanges that need explicit approval:");
  for (const f of plan.findings) {
    warn(
      `[${f.severity}] ${f.kind} ${f.object ?? ""} — ${f.migration}${f.line ? `:${f.line}` : ""}`,
    );
  }
  if (plan.blocked)
    fail("Blocked: objects already exist in the database. Nothing will be applied.");
}

/** `selfauth db <command>` — orchestrates the project's native migration tool (Prisma Migrate). */
export async function db(
  command: string,
  args: { dir?: string; approveDestructive?: boolean; name?: string },
): Promise<number> {
  const dir = await databaseDir(args.dir);
  const manifest = await loadManifest(dir);
  if (!manifest) {
    fail("not a SelfAuth project (selfauth.manifest.json not found)");
    return 1;
  }
  if (manifest.database.orm !== "prisma") {
    fail(`database commands need a database: this project uses '${manifest.database.type}'.`);
    return 1;
  }
  const adapter = new PrismaMigrationAdapter({ cwd: dir });
  try {
    switch (command) {
      case "status": {
        const s = await adapter.status();
        if (s.upToDate) ok("Database is up to date.");
        else info(`Pending: ${s.pending.join(", ") || "—"}  Failed: ${s.failed.join(", ") || "—"}`);
        return 0;
      }
      case "plan":
        printPlan(await adapter.plan());
        return 0;
      case "migrate": {
        if (process.env["NODE_ENV"] === "production")
          warn("Production database: make sure a recent backup exists.");
        const result = await adapter.migrate({
          approveDestructive: Boolean(args.approveDestructive),
        });
        printPlan(result.plan);
        if (result.applied) ok("Migrations applied.");
        else
          (result.reason === "no pending migrations" ? info : fail)(result.reason ?? "not applied");
        return result.applied || result.reason === "no pending migrations" ? 0 : 1;
      }
      case "generate": {
        const created = await adapter.generate(args.name ?? "");
        if (created) ok(`Created ${created.path}; review it, then run \`selfauth db plan\`.`);
        else info("No schema changes.");
        return 0;
      }
      case "validate": {
        const report = await adapter.validate();
        if (report.ok) ok("Schema and ownership manifest are valid.");
        report.problems.forEach(fail);
        return report.ok ? 0 : 1;
      }
      case "rollback":
        info((await adapter.rollback()).guidance);
        return 0;
      default:
        fail(`unknown db command '${command}'`);
        return 1;
    }
  } catch (error) {
    fail((error as Error).message);
    return 1;
  }
}
