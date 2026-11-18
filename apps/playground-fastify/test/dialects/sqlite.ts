import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

/**
 * SQLite stand-ins for test/postgres.ts, used by scripts/dialect-conformance.mjs: each test gets
 * its own database file with the generated migration applied.
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
  /** The database file URL for the Prisma client. */
  url: string;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  drop(): Promise<void>;
}

export async function createTestSchema(options: { migrate?: boolean } = {}): Promise<TestSchema> {
  const dir = mkdtempSync(join(tmpdir(), "selfauth-sqlite-"));
  const file = join(dir, `${randomBytes(4).toString("hex")}.db`);
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  if (options.migrate !== false) {
    for (const m of await migrationFiles()) db.exec(m.sql);
  }
  return {
    schema: file,
    url: `file:${file}`,
    async query<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async drop() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
