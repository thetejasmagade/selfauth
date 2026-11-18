import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { databaseUrlProblems } from "../src/database-env.js";
import { adaptMigrationSql, adaptSchema, adaptStore } from "../src/dialect.js";
import { diagnose, planUpgrade } from "../src/index.js";
import { applyPlan, planAdd, planInit } from "../src/plan.js";
import type { InitAnswers } from "../src/render.js";
import { stackDependencies } from "../src/templates.js";

/**
 * MySQL is derived from the PostgreSQL reference at generation time (src/dialect.ts), like SQLite.
 * The conformance suite runs against the derived code on a real MySQL 8
 * (scripts/dialect-conformance.mjs); these tests pin down what the generator writes.
 */
const answers = (over: Partial<InitAnswers> = {}): InitAnswers => ({
  name: "demo",
  database: "mysql",
  frontend: "none",
  permissions: ["orders.view"],
  appBaseUrl: "http://localhost:5173",
  ...over,
});
const file = (files: { path: string; content: string }[], path: string) => {
  const found = files.find((f) => f.path === path);
  if (!found) throw new Error(`no ${path} in ${files.map((f) => f.path).join(", ")}`);
  return found.content;
};

describe.each(["express", "fastify"] as const)("planInit --database mysql (%s)", (backend) => {
  it("derives the schema: MySQL provider and column types, the insertion-order column kept", async () => {
    const schema = file(await planInit(answers({ backend })), "prisma/schema.prisma");
    expect(schema).toContain('provider = "mysql"');
    expect(schema).toContain("@db.Char(36)");
    expect(schema).toContain("@db.DateTime(3)");
    expect(schema).toContain("@db.VarChar(254)");
    expect(schema).not.toMatch(/@db\.(Uuid|Timestamptz)/);
    expect(schema).toContain("autoincrement()"); // MySQL allows it on a unique column
    expect(schema).not.toMatch(/Json\s+@default/);
  });

  it("uses the MariaDB driver adapter, row locks with a no-op upsert, and PostgreSQL's links", async () => {
    const store = file(await planInit(answers({ backend })), "src/auth/stores/prisma.ts");
    expect(store).toContain("PrismaMariaDb");
    expect(store).not.toMatch(/adapter-pg|PrismaPg|to_timestamp/);
    expect(store).toContain("ON DUPLICATE KEY UPDATE");
    expect(store).toContain("FOR UPDATE");
    expect(store).toContain("skipDuplicates: true"); // MySQL supports it
    expect(store).toContain("MySQL AuthStore backed by Prisma");
    expect(store).not.toContain("dialect:");
    const start = file(await planInit(answers({ backend })), "src/db/store.ts");
    expect(start).toContain("No SelfAuth tables in the database");
    expect(start).not.toContain("PRAGMA");
  });

  it("ships a migration with exact-byte collation, owning tables but no enum types", async () => {
    const files = await planInit(answers({ backend }));
    const migration = files.find((f) =>
      /^prisma\/migrations\/\d+_selfauth_init\/migration\.sql$/.test(f.path),
    );
    expect(migration?.content).toContain("CREATE TABLE `auth_users`");
    expect(migration?.content).toContain("COLLATE utf8mb4_bin");
    expect(migration?.content).not.toContain("utf8mb4_unicode_ci");
    expect(file(files, "prisma/migrations/migration_lock.toml")).toContain('provider = "mysql"');
    const manifest = JSON.parse(file(files, "selfauth.manifest.json"));
    expect(manifest.database).toEqual({ type: "mysql", orm: "prisma" });
    expect(manifest.ownedResources.types).toEqual([]);
  });

  it("sets a MySQL URL in .env.example and the MariaDB packages in package.json", async () => {
    const files = await planInit(answers({ backend }));
    expect(file(files, ".env.example")).toContain(
      "DATABASE_URL=mysql://user:password@localhost:3306/app",
    );
    const pkg = JSON.parse(file(files, "package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps).toHaveProperty("mariadb");
    expect(deps).toHaveProperty("@prisma/adapter-mariadb");
    expect(deps).not.toHaveProperty("pg");
    expect(deps).not.toHaveProperty("better-sqlite3");
  });
});

describe("selfauth add --database mysql", () => {
  it("writes the derived schema and store under the SelfAuth folder", async () => {
    const files = await planAdd(answers(), undefined, { srcDir: "src" });
    expect(file(files, "src/selfauth/auth/stores/prisma.ts")).toContain("PrismaMariaDb");
    expect(file(files, "prisma/schema.prisma")).toContain("../src/selfauth/generated/prisma");
  });
});

describe("the MySQL transforms", () => {
  it("fail loudly when the reference changes", () => {
    expect(() => adaptStore("mysql", "export class X {}")).toThrow(/dialect\.ts/);
    expect(() => adaptSchema("mysql", "model X { id String @id }")).toThrow(/dialect\.ts/);
    expect(() =>
      adaptSchema(
        "mysql",
        'provider = "postgresql"\nSelfAuth data model for PostgreSQL\nx String @db.Money\nmetadata Json @default("{}")\n',
      ),
    ).toThrow(/native type MySQL does not map/);
  });
  it("replace the case-insensitive collation Prisma writes, and refuse SQL without it", () => {
    expect(adaptMigrationSql("mysql", ") COLLATE utf8mb4_unicode_ci;")).toBe(
      ") COLLATE utf8mb4_bin;",
    );
    expect(() => adaptMigrationSql("mysql", "CREATE TABLE x (a int);")).toThrow(/collation/);
    expect(adaptMigrationSql("sqlite", "unchanged")).toBe("unchanged");
  });
});

describe("connection string checks", () => {
  it("expect a mysql:// URL for MySQL", () => {
    expect(databaseUrlProblems("mysql://u:p@h:3306/db", "mysql")).toEqual([]);
    expect(databaseUrlProblems("postgresql://u:p@h/db", "mysql")[0]).toMatch(/mysql:\/\//);
    expect(databaseUrlProblems("mysql://u:p@h/db", "postgresql")[0]).toMatch(/postgresql:\/\//);
  });
  it("lists the MariaDB packages as dependencies", () => {
    expect(stackDependencies("mysql").dependencies).toEqual(
      expect.arrayContaining(["mariadb", "@prisma/adapter-mariadb"]),
    );
  });
});

describe("a generated MySQL project", () => {
  it("is up to date for upgrade and passes doctor", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "selfauth-mysql-")), "app");
    await applyPlan(dir, await planInit(answers()));
    expect((await planUpgrade(dir)).items.filter((i) => i.status !== "unchanged")).toEqual([]);
    expect((await diagnose(dir)).errors).toEqual([]);
  });
});
