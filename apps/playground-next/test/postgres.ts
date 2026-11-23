import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

/**
 * PostgreSQL test helpers. Tests use TEST_DATABASE_URL; each test gets its
 * own schema with the committed migrations applied, so tests are isolated
 * and can run concurrently. Set SELFAUTH_REQUIRE_POSTGRES=1 (CI does) to fail
 * instead of skipping when no database is configured.
 */
export const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];

if (!TEST_DATABASE_URL && process.env["SELFAUTH_REQUIRE_POSTGRES"] === "1") {
  throw new Error("SELFAUTH_REQUIRE_POSTGRES=1 but TEST_DATABASE_URL is not set");
}

export const MIGRATIONS_DIR = new URL("../prisma/migrations/", import.meta.url).pathname;

/** Committed migration SQL files in apply order. */
export async function migrationFiles(): Promise<{ name: string; sql: string }[]> {
  const dirs = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  return Promise.all(
    dirs.map(async (name) => ({
      name,
      sql: await readFile(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"),
    })),
  );
}

export interface TestSchema {
  schema: string;
  /** Runs SQL inside the schema (search_path set). */
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  drop(): Promise<void>;
}

export async function createTestSchema(options: { migrate?: boolean } = {}): Promise<TestSchema> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  const schema = `t_${randomBytes(6).toString("hex")}`;
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  if (options.migrate !== false) {
    for (const m of await migrationFiles()) await client.query(m.sql);
  }
  return {
    schema,
    async query(sql, params) {
      return (await client.query(sql, params as unknown[])).rows;
    },
    async drop() {
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
      await client.end();
    },
  };
}
