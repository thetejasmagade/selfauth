import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseUrlProblems } from "../src/database-env.js";
import { adaptSchema, adaptStore } from "../src/dialect.js";
import { init } from "../src/commands/init.js";
import { applyPlan, planAdd, planInit } from "../src/plan.js";
import { diagnose, planUpgrade } from "../src/index.js";
import { stackDependencies } from "../src/templates.js";
import type { InitAnswers } from "../src/render.js";

/**
 * SQLite is derived from the PostgreSQL reference at generation time (src/dialect.ts). The
 * conformance suite runs against the derived code (scripts/dialect-conformance.mjs); these tests
 * pin down what the generator writes.
 */
const answers = (over: Partial<InitAnswers> = {}): InitAnswers => ({
  name: "demo",
  database: "sqlite",
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

describe.each(["express", "fastify"] as const)("planInit --database sqlite (%s)", (backend) => {
  it("derives the schema: SQLite provider, no PostgreSQL native types, no autoincrement column", async () => {
    const files = await planInit(answers({ backend }));
    const schema = file(files, "prisma/schema.prisma");
    expect(schema).toContain('provider = "sqlite"');
    expect(schema).not.toContain("@db.");
    expect(schema).not.toContain("autoincrement");
    expect(schema).not.toMatch(/Json\s+@default/);
    expect(schema).toContain("model AuthUser");
  });

  it("uses the SQLite client and no PostgreSQL SQL in the store", async () => {
    const store = file(await planInit(answers({ backend })), "src/auth/stores/prisma.ts");
    expect(store).toContain("PrismaBetterSqlite3");
    expect(store).not.toMatch(/adapter-pg|PrismaPg|FOR UPDATE|to_timestamp|skipDuplicates/);
    expect(store).toContain("INSERT OR IGNORE INTO auth_rate_limits");
    expect(store).toContain("SQLite AuthStore backed by Prisma");
    // Start-up explains a missing migration instead of Prisma's "table does not exist".
    const start = file(await planInit(answers({ backend })), "src/db/store.ts");
    expect(start).toContain("No SelfAuth tables in ${databaseUrl}");
    expect(start).toContain("PRAGMA journal_mode = WAL");
  });

  it("ships the generated SQLite migration and lock file, owning tables but no enum types", async () => {
    const files = await planInit(answers({ backend }));
    const migration = files.find((f) =>
      /^prisma\/migrations\/\d+_selfauth_init\/migration\.sql$/.test(f.path),
    );
    expect(migration?.content).toContain('CREATE TABLE "auth_users"');
    expect(migration?.content).not.toMatch(/uuid|timestamptz|CREATE TYPE/i);
    expect(file(files, "prisma/migrations/migration_lock.toml")).toContain('provider = "sqlite"');
    const manifest = JSON.parse(file(files, "selfauth.manifest.json"));
    expect(manifest.database).toEqual({ type: "sqlite", orm: "prisma" });
    expect(manifest.ownedResources.tables).toContain("auth_rate_limits");
    expect(manifest.ownedResources.types).toEqual([]);
  });

  it("sets the SQLite file URL in .env.example and the SQLite dependencies in package.json", async () => {
    const files = await planInit(answers({ backend }));
    expect(file(files, ".env.example")).toContain("DATABASE_URL=file:./app.db");
    const pkg = JSON.parse(file(files, "package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps).toHaveProperty("better-sqlite3");
    expect(deps).toHaveProperty("@prisma/adapter-better-sqlite3");
    expect(deps).not.toHaveProperty("pg");
    expect(pkg.scripts["db:migrate"]).toBe("prisma migrate deploy");
  });

  it("is the same as PostgreSQL everywhere the database does not matter", async () => {
    const sqlite = await planInit(answers({ backend }));
    const postgres = await planInit(answers({ backend, database: "postgresql" }));
    const differing = sqlite
      .filter((s) => postgres.find((p) => p.path === s.path)?.content !== s.content)
      .map((s) => s.path)
      .sort();
    // Only the database-specific files differ; everything else is byte for byte the same.
    const databaseSpecific = [
      ".env.example",
      "README.md",
      "package.json",
      "prisma/migrations/20261116085533_selfauth_init/migration.sql",
      "prisma/migrations/migration_lock.toml",
      "prisma/schema.prisma",
      "selfauth.manifest.json",
      "src/auth/stores/prisma.ts",
      "src/config/selfauth.config.ts",
      "src/db/store.ts",
    ];
    for (const path of differing) expect(databaseSpecific, path).toContain(path);
    expect(differing).toEqual(
      expect.arrayContaining(["prisma/schema.prisma", "src/auth/stores/prisma.ts"]),
    );
  });
});

describe("selfauth add --database sqlite", () => {
  it("writes the derived schema and store under the SelfAuth folder", async () => {
    const files = await planAdd(answers({ frontend: "none" }), undefined, { srcDir: "src" });
    expect(file(files, "src/selfauth/auth/stores/prisma.ts")).toContain("PrismaBetterSqlite3");
    expect(file(files, "prisma/schema.prisma")).toContain('provider = "sqlite"');
    expect(file(files, "prisma/schema.prisma")).toContain("../src/selfauth/generated/prisma");
  });
});

describe("dialect transforms fail loudly when the reference changes", () => {
  it("refuses a store without the dialect markers", () => {
    expect(() => adaptStore("sqlite", "export class X {}")).toThrow(/dialect\.ts/);
  });
  it("refuses a schema it does not recognise", () => {
    expect(() => adaptSchema("sqlite", "model X { id String @id }")).toThrow(/dialect\.ts/);
  });
});

describe("connection string checks", () => {
  it("expect a file: URL for SQLite and a postgres URL for PostgreSQL", () => {
    expect(databaseUrlProblems("file:./app.db", "sqlite")).toEqual([]);
    expect(databaseUrlProblems("postgresql://u:p@h/db", "sqlite")[0]).toMatch(/file:/);
    expect(databaseUrlProblems("file:./app.db", "postgresql")[0]).toMatch(/postgresql:\/\//);
  });
  it("lists the SQLite packages as dependencies", () => {
    expect(stackDependencies("sqlite").dependencies).toContain("better-sqlite3");
  });
});

describe("selfauth init --database sqlite", () => {
  afterEach(() => vi.restoreAllMocks());
  it("plans a SQLite project in a dry run", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.join(" ")));
    const dir = join(await mkdtemp(join(tmpdir(), "selfauth-sqlite-")), "app");
    const code = await init(dir, { database: "sqlite", dryRun: true, yes: true });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("SQLite/Prisma");
  });
});

describe("a generated SQLite project", () => {
  it("is up to date for upgrade and passes doctor", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "selfauth-sqlite-")), "app");
    await applyPlan(dir, await planInit(answers()));
    const plan = await planUpgrade(dir);
    expect(plan.items.filter((i) => i.status !== "unchanged")).toEqual([]);
    expect((await diagnose(dir)).errors).toEqual([]);
  });

  it("leaves PostgreSQL projects free of the dialect marker comments", async () => {
    const store = file(
      await planInit(answers({ database: "postgresql" })),
      "src/auth/stores/prisma.ts",
    );
    expect(store).not.toContain("dialect:");
    expect(store).toContain("FOR UPDATE");
  });
});
