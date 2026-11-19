import { spawnSync } from "node:child_process";
import { PrismaMigrationAdapter, type MigrationPlan } from "@selfauth/migration";
import { databaseUrlProblems, readDatabaseEnv } from "../database-env.js";
import { DATABASE_INFO, type Database } from "../templates.js";
import { databaseDir, loadManifest } from "../project.js";
import { fail, info, ok, say, warn } from "./output.js";

/** The last lines of a tool's output, indented, for a failure message. */
export function indentOutput(output: string, lines = 15): string {
  const kept = output.trim().split("\n").slice(-lines);
  return kept.map((line) => `    ${line}`).join("\n");
}

/** What a finding means, in a sentence a person can act on. */
const FINDING_TEXT: Record<string, string> = {
  drop_table:
    "deletes a table and its rows (SQLite does this to rebuild a table when a column is dropped: check the SQL copies the data first)",
  drop_column: "deletes a column and the data in it",
  drop_type: "deletes a database type",
  drop_schema: "deletes a whole schema or database",
  truncate: "empties a table",
  delete: "deletes rows",
  alter_column_type: "changes a column's type; existing values may not convert",
  set_not_null: "makes a column required; it fails if any row is empty there",
  rename: "renames something; code and data that use the old name break",
  drop_constraint: "removes a rule the database was enforcing",
  drop_index: "removes an index; queries may get slower",
  selfauth_table: "changes a table SelfAuth owns (auth_…); that can break `selfauth upgrade`",
  not_owned: "a SelfAuth migration changes a table SelfAuth does not own",
  already_exists: "creates something that is already in the database",
};

function printPlan(plan: MigrationPlan) {
  if (plan.pending.length === 0) return ok("No pending migrations.");
  say(`Pending migrations (${plan.pending.length}):`);
  for (const m of plan.pending) say(`  • ${m.name}  (${m.path})`);
  if (plan.findings.length === 0)
    return ok("Nothing here loses data or touches SelfAuth's tables.");
  say("\nChanges that need explicit approval:");
  for (const f of plan.findings) {
    warn(
      `[${f.severity}] ${f.kind} ${f.object ?? ""} — ${f.migration}${f.line ? `:${f.line}` : ""}`,
    );
    const text = FINDING_TEXT[f.kind];
    if (text) say(`      ${text}`);
  }
  if (plan.blocked)
    fail("Blocked: objects already exist in the database. Nothing will be applied.");
}

/**
 * MongoDB projects have no SQL migrations: `db migrate` runs the project's own script, which
 * creates the indexes (and only creates), and `db plan` / `db status` list what it would create.
 */
function runMongoScript(dir: string, args: string[], env: NodeJS.ProcessEnv): number {
  const result = spawnSync(process.execPath, ["src/scripts/migrate.ts", ...args], {
    cwd: dir,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail("The index script failed; the message above says why (is `npm install` done?).");
    return 1;
  }
  return 0;
}

/**
 * Go projects have their own small migration runner (cmd/migrate): `status` and `migrate` run it,
 * `plan` shows what it would apply. It is plain SQL files, so `validate`/`generate`/`rollback`
 * have nothing to orchestrate and say so.
 */
async function goDb(dir: string, command: string, database: Database): Promise<number> {
  if (!["status", "plan", "migrate"].includes(command)) {
    info(
      command === "validate"
        ? "Go projects keep plain SQL migrations in db/migrations; `selfauth validate` checks the generated files."
        : command === "rollback"
          ? "There is no automatic rollback: restore from a backup, or add a new migration that reverses the change."
          : "Add a new directory under db/migrations/ with a migration.sql file, then run `selfauth db migrate`.",
    );
    return command === "validate" || command === "rollback" || command === "generate" ? 0 : 1;
  }
  const found = await readDatabaseEnv(dir);
  if (!found.url) {
    fail("DATABASE_URL is not set, so there is no database to connect to.");
    say(`  environment variable:  ${found.environment}`);
    info(
      "Export DATABASE_URL (see .env.example) or put it in .env; the migration runner reads the environment.",
    );
    return 1;
  }
  const problems = databaseUrlProblems(found.url, database);
  if (problems.length) {
    fail(`DATABASE_URL (from ${found.source}) cannot be used: ${problems.join("; ")}.`);
    return 1;
  }
  const args = ["run", "./cmd/migrate", command === "migrate" ? "up" : "status"];
  if (command === "migrate" && process.env["APP_ENV"] === "production")
    warn("Production database: make sure a recent backup exists.");
  const result = spawnSync("go", args, {
    cwd: dir,
    env: { ...process.env, DATABASE_URL: found.url },
    stdio: "inherit",
  });
  if (result.error) {
    fail("Could not run `go` (is Go installed and on your PATH?).");
    return 1;
  }
  if (command === "plan")
    info(
      database === "mongodb"
        ? "MongoDB has no migrations: `selfauth db migrate` creates the indexes listed above and never drops one."
        : "Read each pending migration.sql in db/migrations/ before running `selfauth db migrate`.",
    );
  return result.status ?? 1;
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
  if (manifest.options?.backend === "gin" && manifest.database.type !== "memory") {
    return goDb(dir, command, manifest.database.type as Database);
  }
  if (manifest.database.orm === "none") {
    fail(`database commands need a database: this project uses '${manifest.database.type}'.`);
    return 1;
  }
  const mongo = manifest.database.orm === "mongoose";
  if (mongo && !["status", "plan", "migrate"].includes(command)) {
    info(
      command === "rollback"
        ? "MongoDB has no migrations to roll back: `db:migrate` only creates indexes and never changes your data."
        : `\`selfauth db ${command}\` is for SQL databases. MongoDB only needs its indexes: \`selfauth db migrate\`.`,
    );
    return command === "validate" || command === "rollback" ? 0 : 1;
  }
  // These commands connect to the database; the others (validate, rollback) read files only.
  let env: NodeJS.ProcessEnv | undefined;
  if (["status", "plan", "migrate", "generate"].includes(command)) {
    const found = await readDatabaseEnv(dir);
    if (!found.url) {
      fail("DATABASE_URL is not set, so there is no database to connect to.");
      say(`  environment variable:  ${found.environment}`);
      say(`  ${found.path}:  ${found.envFile}`);
      info(
        `Add a line like DATABASE_URL=${DATABASE_INFO[manifest.database.type as Database].urlExample} to ${found.path} (and save the file), or set the variable in your shell.`,
      );
      return 1;
    }
    const problems = databaseUrlProblems(found.url, manifest.database.type as Database);
    if (problems.length) {
      fail(`DATABASE_URL (from ${found.source}) cannot be used: ${problems.join("; ")}.`);
      return 1;
    }
    // Hand the value to Prisma directly, so it does not depend on prisma.config.ts finding .env.
    env = { ...process.env, DATABASE_URL: found.url };
    if (mongo) return runMongoScript(dir, command === "migrate" ? [] : ["--plan"], env);
  }
  const adapter = new PrismaMigrationAdapter({ cwd: dir, ...(env ? { env } : {}) });
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
        // The tool's own words say why it failed: show them rather than only "failed".
        if (!result.applied && result.output.trim()) say(indentOutput(result.output));
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
