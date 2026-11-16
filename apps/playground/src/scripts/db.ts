/* eslint-disable no-console */
/**
 * Database commands for this app (precursor of `selfauth db …`, Phase 6).
 * They orchestrate native Prisma Migrate and never run at application startup.
 *
 *   node src/scripts/db.ts status | plan | validate | rollback
 *   node src/scripts/db.ts migrate [--approve-destructive]
 *   node src/scripts/db.ts generate <name>
 */
import { fileURLToPath } from "node:url";
import { PrismaMigrationAdapter } from "@selfauth/migration";

const cwd = fileURLToPath(new URL("../..", import.meta.url));
const adapter = new PrismaMigrationAdapter({ cwd });
const [command = "status", ...args] = process.argv.slice(2);

function printPlan(plan: Awaited<ReturnType<typeof adapter.plan>>) {
  if (plan.pending.length === 0) return console.log("No pending migrations.");
  console.log(`Pending migrations (${plan.pending.length}):`);
  for (const m of plan.pending) console.log(`  • ${m.name}  (${m.path})`);
  if (plan.findings.length === 0)
    return console.log("\nNo destructive or non-owned changes found.");
  console.log("\nChanges that need explicit approval:");
  for (const f of plan.findings) {
    console.log(
      `  ✗ [${f.severity}] ${f.kind} ${f.object ?? ""} — ${f.migration}:${f.line}\n      ${f.statement.split("\n")[0]}`,
    );
  }
}

switch (command) {
  case "status": {
    const s = await adapter.status();
    console.log(
      s.upToDate
        ? "Database is up to date."
        : `Pending: ${s.pending.join(", ") || "—"}  Failed: ${s.failed.join(", ") || "—"}`,
    );
    break;
  }
  case "plan":
    printPlan(await adapter.plan());
    break;
  case "migrate": {
    if (process.env["NODE_ENV"] === "production") {
      console.log("Production database: make sure a recent backup exists before continuing.");
    }
    const result = await adapter.migrate({
      approveDestructive: args.includes("--approve-destructive"),
    });
    printPlan(result.plan);
    console.log(result.applied ? "\nMigrations applied." : `\nNot applied: ${result.reason}`);
    if (result.output.trim()) console.log(result.output.trim());
    process.exitCode = result.applied || result.reason === "no pending migrations" ? 0 : 1;
    break;
  }
  case "generate": {
    const created = await adapter.generate(args[0] ?? "");
    console.log(created ? `Created ${created.path} — review it, then run migrate.` : "No changes.");
    break;
  }
  case "validate": {
    const report = await adapter.validate();
    console.log(
      report.ok
        ? "Schema and ownership manifest are valid."
        : report.problems.map((p) => `✗ ${p}`).join("\n"),
    );
    process.exitCode = report.ok ? 0 : 1;
    break;
  }
  case "rollback":
    console.log((await adapter.rollback()).guidance);
    break;
  default:
    console.error(`Unknown command '${command}'`);
    process.exitCode = 1;
}
