import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import mariadb from "mariadb";

/**
 * MySQL stand-ins for test/postgres.ts, used by scripts/dialect-conformance.mjs: each test gets
 * its own database with the generated migration applied. TEST_DATABASE_URL names a database on a
 * MySQL server the user can create databases on.
 */
export const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];

const MIGRATIONS_DIR = new URL("../prisma/migrations/", import.meta.url).pathname;

export async function migrationFiles(): Promise<{ name: string; sql: string }[]> {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"),
    }));
}

export interface TestSchema {
  schema: string;
  /** The database URL for the Prisma client. */
  url: string;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  drop(): Promise<void>;
}

export async function createTestSchema(options: { migrate?: boolean } = {}): Promise<TestSchema> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  const base = new URL(TEST_DATABASE_URL);
  const connection = await mariadb.createConnection({
    host: base.hostname,
    port: Number(base.port || 3306),
    user: decodeURIComponent(base.username),
    password: decodeURIComponent(base.password),
    multipleStatements: true,
  });
  const name = `t_${randomBytes(6).toString("hex")}`;
  await connection.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
  await connection.query(`USE \`${name}\``);
  if (options.migrate !== false) {
    for (const m of await migrationFiles()) await connection.query(m.sql);
  }
  const url = new URL(base);
  url.pathname = `/${name}`;
  return {
    schema: name,
    url: url.toString(),
    async query<T>(sql: string, params: unknown[] = []) {
      return (await connection.query(sql, params)) as T[];
    },
    async drop() {
      await connection.query(`DROP DATABASE \`${name}\``);
      await connection.end();
    },
  };
}
