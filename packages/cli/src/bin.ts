#!/usr/bin/env node
import { Command } from "commander";
import { add } from "./commands/add.js";
import { addFrontend } from "./commands/add-frontend.js";
import { db } from "./commands/db.js";
import { detect } from "./commands/detect.js";
import { doctor } from "./commands/doctor.js";
import { init } from "./commands/init.js";
import { list } from "./commands/list.js";
import { skillInstall } from "./commands/skill.js";
import { diffCommand, upgrade } from "./commands/upgrade.js";
import { validate } from "./commands/validate.js";
import { CLI_VERSION } from "./version.js";

const program = new Command()
  .name("selfauth")
  .description(
    "Generate project-local authentication you own. Nothing here runs in your app at runtime.",
  )
  .version(CLI_VERSION);

const exit = (code: number) => {
  process.exitCode = code;
};

program
  .command("init [dir]")
  .description("generate a new Express, Fastify or Gin (Go) project with SelfAuth authentication")
  .option("--backend <framework>", "express | fastify | gin (default: express)")
  .option("--database <db>", "postgresql | mysql | sqlite | mongodb | memory")
  .option("--frontend <fw>", "none | vue | react (generated into web/)")
  .option(
    "--permissions <list>",
    "comma-separated application permissions, e.g. orders.view,orders.create",
  )
  .option(
    "--app-base-url <url>",
    "frontend origin used in email links (default: the frontend dev server)",
  )
  .option("-y, --yes", "non-interactive: accept the plan")
  .option("--dry-run", "show the plan without writing anything")
  .option("--install", "run npm install after generating")
  .option("--module <path>", "Gin: the Go module path (default: the project name)")
  .action(async (dir: string | undefined, opts) => exit(await init(dir, opts)));

program
  .command("add [dir]")
  .description(
    "add SelfAuth to an existing Express or Fastify + TypeScript project (new files only)",
  )
  .option("--backend <framework>", "express | fastify (default: the one in package.json)")
  .option("--database <db>", "memory | postgresql | mysql | sqlite | mongodb", "memory")
  .option(
    "--src <dir>",
    "source folder to write under (<dir>/selfauth/); default: found from your backend entry file",
  )
  .option("--permissions <list>", "comma-separated application permissions")
  .option("--app-base-url <url>", "frontend origin used in email links", "http://localhost:5173")
  .option("--allow-existing-auth", "continue even though other auth packages are installed")
  .option("-y, --yes", "non-interactive: accept the plan")
  .option("--dry-run", "show the plan without writing anything")
  .option("--install", "install the dependencies with your package manager")
  .action(async (dir: string | undefined, opts) => exit(await add(dir, opts)));

program
  .command("add-frontend [dir]")
  .description("add the authentication module to an existing Vue or React app (new files only)")
  .option("--frontend <name>", "vue | react (default: found from package.json)")
  .option("--src <dir>", "source folder to write under (<dir>/selfauth/)", "src")
  .option("-y, --yes", "non-interactive: accept the plan")
  .option("--dry-run", "show the plan without writing anything")
  .option("--install", "install missing packages with your package manager")
  .action(async (dir: string | undefined, opts) => exit(await addFrontend(dir, opts)));

program
  .command("detect [dir]")
  .description(
    "inspect a project: stack, existing auth, and which SelfAuth command applies (reads only)",
  )
  .option("--json", "machine-readable output (for agents)")
  .action(async (dir: string | undefined, opts) => exit(await detect(dir, opts)));

program
  .command("list")
  .description("list supported integrations")
  .option("--json", "machine-readable output (for agents)")
  .action((opts) => exit(list(opts)));

program
  .command("doctor [dir]")
  .description("check configuration and production readiness")
  .option("--json", "machine-readable output (for agents)")
  .action(async (dir: string | undefined, opts) => exit(await doctor(dir, opts)));

program
  .command("validate [dir]")
  .description("validate configuration, generated files and the database schema manifest")
  .option("--json", "machine-readable output (for agents)")
  .action(async (dir: string | undefined, opts) => exit(await validate(dir, opts)));

program
  .command("diff [dir]")
  .description("show what an upgrade to this CLI's templates would change (writes nothing)")
  .action(async (dir: string | undefined) => exit(await diffCommand(dir)));

program
  .command("upgrade [dir]")
  .description("update generated files you have not edited; write proposals for the ones you have")
  .option("-y, --yes", "apply without asking")
  .option("--dry-run", "show the plan without writing")
  .option(
    "--reorganize",
    "move a project made with SelfAuth 0.3 or earlier (flat src/) into the grouped layout",
  )
  .action(async (dir: string | undefined, opts) => exit(await upgrade(dir, opts)));

program
  .command("skill")
  .description("the `selfauth` skill for coding agents (Claude Code, Codex, Cursor)")
  .command("install [dir]")
  .description("copy the skill into the project where your agent finds it")
  .option("--agent <list>", "claude | codex | cursor | all (comma-separated)", "claude")
  .option("--update", "replace skill files that differ from this CLI's version")
  .option("--dry-run", "show what would be written")
  .action(async (dir: string | undefined, opts) => exit(await skillInstall(dir, opts)));

const dbCmd = program
  .command("db")
  .description("review and apply database migrations with the native tool");
for (const [name, description] of [
  ["status", "show applied and pending migrations"],
  ["plan", "review pending migrations for destructive or non-owned changes"],
  ["migrate", "apply pending migrations (refuses destructive changes unless approved)"],
  ["validate", "check the schema and the ownership manifest"],
  ["rollback", "explain how to roll back (no automatic down migrations)"],
] as const) {
  const c = dbCmd
    .command(name)
    .description(description)
    .option("--dir <dir>", "project directory", ".");
  if (name === "migrate")
    c.option(
      "--approve-destructive",
      "apply even if the plan has destructive or non-owned changes",
    );
  c.action(async (opts: { dir: string; approveDestructive?: boolean }) =>
    exit(await db(name, opts)),
  );
}
dbCmd
  .command("generate <name>")
  .description("create a migration from schema changes (not applied)")
  .option("--dir <dir>", "project directory", ".")
  .action(async (name: string, opts: { dir: string }) =>
    exit(await db("generate", { ...opts, name })),
  );

await program.parseAsync();
