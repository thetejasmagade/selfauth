#!/usr/bin/env node
/* global process, console */
/* eslint-disable no-console -- script output */
// Runs the conformance suite against a database that is derived from the PostgreSQL reference.
// Usage: node scripts/dialect-conformance.mjs <sqlite> <playground|playground-fastify> [vitest args]
//
// It copies the reference app into apps/<app>/.dialect/<db>/ (git-ignored), applies the same
// transforms `selfauth init` applies (packages/cli/src/dialect.ts), generates the migration with
// Prisma, replaces the PostgreSQL test helpers with the database's, and runs the suite there.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [dialect, app, ...vitestArgs] = process.argv.slice(2);
if (!dialect || !app) {
  console.error(
    "usage: dialect-conformance.mjs <sqlite> <playground|playground-fastify> [vitest args]",
  );
  process.exit(2);
}
const { adaptForDialect } = await import(
  pathToFileURL(join(root, "packages/cli/dist/dialect.js")).href
);
const appDir = join(root, "apps", app);
const out = join(appDir, ".dialect", dialect);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const entry of ["src", "test", "prisma", "prisma.config.ts", "tsconfig.json"]) {
  cpSync(join(appDir, entry), join(out, entry), {
    recursive: true,
    filter: (p) => !p.includes("/generated") && !p.includes("/prisma/migrations"),
  });
}
// The copy sits two folders deeper than the app.
const tsconfig = join(out, "tsconfig.json");
writeFileSync(
  tsconfig,
  readFileSync(tsconfig, "utf8").replace(
    "../../tsconfig.base.json",
    "../../../../tsconfig.base.json",
  ),
);
const adapt = (target) => {
  const file = join(out, target);
  writeFileSync(file, adaptForDialect(dialect, target, readFileSync(file, "utf8")));
};
for (const target of ["prisma/schema.prisma", "src/auth/stores/prisma.ts", "src/db/store.ts"])
  adapt(target);

const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { cwd: out, stdio: "inherit", env: process.env, ...options });
  if (r.status !== 0) process.exit(r.status ?? 1);
  return r;
};
const prisma = join(appDir, "node_modules/prisma/build/index.js");
const migration = join(out, "prisma/migrations/0001_init");
mkdirSync(migration, { recursive: true });
writeFileSync(join(out, "prisma/migrations/migration_lock.toml"), `provider = "${dialect}"\n`);
run(process.execPath, [
  prisma,
  "migrate",
  "diff",
  "--from-empty",
  "--to-schema",
  "prisma/schema.prisma",
  "--script",
  "--output",
  "prisma/migrations/0001_init/migration.sql",
]);
run(process.execPath, [prisma, "generate"], {
  env: { ...process.env, DATABASE_URL: "file:./unused.db" },
});

// The database's own test helpers replace the PostgreSQL ones (same exports).
const helpers = join(root, "apps", app, "test", "dialects", `${dialect}.ts`);
if (!existsSync(helpers)) {
  console.error(`missing ${helpers}`);
  process.exit(1);
}
cpSync(helpers, join(out, "test/postgres.ts"));
cpSync(
  join(root, "apps", app, "test", "dialects", `${dialect}-events.ts`),
  join(out, "test/conformance/events.ts"),
);
const helperFile = join(out, "test/helpers.ts");
const original = readFileSync(helperFile, "utf8");
const patched = original.replace(
  /connectionString: TEST_DATABASE_URL!,\s*schema: schema\.schema,/,
  "connectionString: schema.url,\n      schema: schema.schema,",
);
if (patched === original)
  throw new Error("test/helpers.ts changed: update dialect-conformance.mjs");
writeFileSync(helperFile, patched);

console.log(`\n== conformance on ${dialect}, ${app} (${out})\n`);
run(
  "pnpm",
  ["exec", "vitest", "run", "--root", out, "test/conformance/conformance.test.ts", ...vitestArgs],
  {
    env: { ...process.env, TEST_DATABASE_URL: `${dialect}:harness`, DATABASE_URL: "" },
  },
);
