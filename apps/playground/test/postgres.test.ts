import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  analyzeSql,
  createdObjects,
  PrismaMigrationAdapter,
  readManifest,
} from "@selfauth/migration";
import { parseConfig } from "@selfauth/spec";
import { afterEach, describe, expect, it } from "vitest";
import { roleDefinitions } from "../src/auth/core/authorization.ts";
import { ManualClock } from "../src/auth/core/clock.ts";
import { RateLimiter } from "../src/auth/core/rate-limit.ts";
import {
  createPrismaClient,
  PrismaAuthStore,
  PrismaRateLimitStore,
} from "../src/auth/stores/prisma.ts";
import {
  createTestSchema,
  migrationFiles,
  TEST_DATABASE_URL,
  type TestSchema,
} from "./postgres.ts";

const PROJECT = fileURLToPath(new URL("..", import.meta.url));
const run = promisify(execFile);

/** DATABASE_URL pointing Prisma's CLI at one test schema. */
function urlFor(schema: string): string {
  const url = new URL(TEST_DATABASE_URL!);
  url.searchParams.set("schema", schema);
  return url.href;
}

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function schema(options: { migrate?: boolean } = {}): Promise<TestSchema> {
  const s = await createTestSchema(options);
  cleanup.push(() => s.drop());
  return s;
}

function adapterFor(s: TestSchema) {
  return new PrismaMigrationAdapter({
    cwd: PROJECT,
    env: { ...process.env, DATABASE_URL: urlFor(s.schema) },
  });
}

async function tables(s: TestSchema): Promise<string[]> {
  const rows = await s.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
    [s.schema],
  );
  return rows.map((r) => r.table_name);
}

describe("ownership manifest", () => {
  it("lists exactly the objects the committed migrations create", async () => {
    const manifest = await readManifest(`${PROJECT}/selfauth.manifest.json`);
    const files = await migrationFiles();
    const created = files.map((f) => createdObjects(f.sql));
    expect([...manifest.ownedResources.tables].sort()).toEqual(
      created.flatMap((c) => c.tables).sort(),
    );
    expect([...manifest.ownedResources.types].sort()).toEqual(
      created.flatMap((c) => c.types).sort(),
    );
    expect(manifest.ownedResources.migrations).toEqual(files.map((f) => f.name));
  });

  it("the initial migration is purely additive", async () => {
    for (const f of await migrationFiles()) {
      expect(analyzeSql(f.sql, createdObjects(f.sql))).toEqual([]);
    }
  });
});

describe.runIf(TEST_DATABASE_URL)("PostgreSQL migrations (native Prisma Migrate)", () => {
  it("plans, applies and verifies migrations on a fresh database (DATA-MODEL-003)", async () => {
    const s = await schema({ migrate: false });
    const adapter = adapterFor(s);

    const before = await adapter.status();
    expect(before.upToDate).toBe(false);
    expect(before.pending).toHaveLength((await migrationFiles()).length);

    const plan = await adapter.plan();
    expect(plan.requiresApproval).toBe(false);

    const result = await adapter.migrate({ approveDestructive: false });
    expect(result.applied, result.output).toBe(true);
    expect((await adapter.status()).upToDate).toBe(true);
    expect((await adapter.validate()).problems).toEqual([]);

    // No drift: the migrated database matches schema.prisma exactly.
    const diff = await run(
      `${PROJECT}/node_modules/.bin/prisma`,
      [
        "migrate",
        "diff",
        "--from-config-datasource",
        "--to-schema",
        "prisma/schema.prisma",
        "--exit-code",
      ],
      { cwd: PROJECT, env: { ...process.env, DATABASE_URL: urlFor(s.schema) } },
    ).then(
      () => 0,
      (e: { code?: number }) => e.code ?? 1,
    );
    expect(diff).toBe(0);

    // Unique constraints are enforced by the database (DATA-MODEL-001).
    const indexes = await s.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = $1",
      [s.schema],
    );
    const unique = indexes
      .filter((i) => i.indexdef.startsWith("CREATE UNIQUE"))
      .map((i) => i.indexdef);
    for (const column of ["email_normalized", "token_hash", "name"]) {
      expect(unique.some((d) => d.includes(`(${column})`))).toBe(true);
    }
  }, 60_000);

  /**
   * An existing application that already uses Prisma: its own migration
   * history is applied and holds data; SelfAuth's migration is added after it.
   */
  async function existingPrismaProject(appSql: string) {
    const s = await schema({ migrate: false });
    const dir = await mkdtemp(join(tmpdir(), "selfauth-app-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const migrations = join(dir, "migrations");
    await mkdir(join(migrations, "20250101000000_app_init"), { recursive: true });
    await writeFile(join(migrations, "20250101000000_app_init", "migration.sql"), appSql);
    await writeFile(join(migrations, "migration_lock.toml"), 'provider = "postgresql"\n');
    const configPath = join(dir, "prisma.config.ts");
    await writeFile(
      configPath,
      `export default { schema: ${JSON.stringify(`${PROJECT}/prisma/schema.prisma`)}, migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: process.env.DATABASE_URL } };\n`,
    );
    const adapter = new PrismaMigrationAdapter({
      cwd: PROJECT,
      migrationsPath: migrations,
      configPath,
      env: { ...process.env, DATABASE_URL: urlFor(s.schema) },
    });
    const addSelfAuthMigrations = async () => {
      for (const m of await migrationFiles()) {
        await mkdir(join(migrations, m.name));
        await writeFile(join(migrations, m.name, "migration.sql"), m.sql);
      }
    };
    return { s, adapter, addSelfAuthMigrations };
  }

  it("leaves pre-existing application tables and data untouched (DATA-MODEL-004)", async () => {
    const { s, adapter, addSelfAuthMigrations } = await existingPrismaProject(
      `CREATE TABLE users (id serial PRIMARY KEY, name text NOT NULL);
       CREATE TABLE orders (id serial PRIMARY KEY, user_id int REFERENCES users(id), total numeric);`,
    );
    expect((await adapter.migrate({ approveDestructive: false })).applied).toBe(true); // the app's own history
    await s.query(
      `INSERT INTO users (name) VALUES ('existing'); INSERT INTO orders (user_id, total) VALUES (1, 9.5)`,
    );
    const columns = () =>
      s.query(
        "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name IN ('users','orders') ORDER BY 1, 2",
        [s.schema],
      );
    const columnsBefore = await columns();

    await addSelfAuthMigrations();
    const plan = await adapter.plan();
    expect(plan.pending.map((p) => p.name)).toEqual((await migrationFiles()).map((m) => m.name));
    expect(plan.findings).toEqual([]);
    const result = await adapter.migrate({ approveDestructive: false });
    expect(result.applied, result.output).toBe(true);

    expect(await s.query("SELECT name FROM users")).toEqual([{ name: "existing" }]);
    expect(await s.query("SELECT user_id, total FROM orders")).toEqual([
      { user_id: 1, total: "9.5" },
    ]);
    expect(await columns()).toEqual(columnsBefore);
    expect(await tables(s)).toEqual(
      expect.arrayContaining(["users", "orders", "auth_users", "auth_sessions"]),
    );
  }, 60_000);

  it("detects a name conflict before changing anything", async () => {
    const { s, adapter, addSelfAuthMigrations } = await existingPrismaProject(
      `CREATE TABLE auth_users (legacy_id int PRIMARY KEY);`,
    );
    await adapter.migrate({ approveDestructive: false });
    await s.query(`INSERT INTO auth_users VALUES (42)`);
    await addSelfAuthMigrations();

    const plan = await adapter.plan();
    expect(plan.blocked).toBe(true);
    expect(plan.findings).toContainEqual(
      expect.objectContaining({ kind: "already_exists", object: "auth_users" }),
    );
    const result = await adapter.migrate({ approveDestructive: true });
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/already exist/);
    expect(await s.query("SELECT legacy_id FROM auth_users")).toEqual([{ legacy_id: 42 }]);
    expect((await tables(s)).filter((t) => t.startsWith("auth_"))).toEqual(["auth_users"]);
  }, 60_000);

  it("explains baselining for an existing database without Prisma history (P3005)", async () => {
    const s = await schema({ migrate: false });
    await s.query(`CREATE TABLE customers (id serial PRIMARY KEY)`);
    const result = await adapterFor(s).migrate({ approveDestructive: false });
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/Baseline it first/);
    expect(await tables(s)).toEqual(["customers"]);
  }, 60_000);

  it("explains that rollback is not automatic", async () => {
    const s = await schema({ migrate: false });
    expect((await adapterFor(s).rollback()).automatic).toBe(false);
  });
});

describe.runIf(TEST_DATABASE_URL)("PrismaAuthStore on PostgreSQL", () => {
  async function store() {
    const s = await schema();
    const db = createPrismaClient({
      connectionString: TEST_DATABASE_URL!,
      schema: s.schema,
      max: 4,
    });
    cleanup.push(() => db.$disconnect());
    return { s, db, store: new PrismaAuthStore(db) };
  }

  it("creates users atomically: a failed role link leaves nothing behind (AUTHN-REG-003)", async () => {
    const { s, store: st } = await store();
    const now = new Date();
    await expect(
      st.createUser({
        user: {
          id: crypto.randomUUID(),
          email: "a@x.test",
          emailNormalized: "a@x.test",
          emailVerifiedAt: null,
          state: "pending",
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$x$y",
        roles: ["missing"],
      }),
    ).rejects.toThrow(/not synchronized/);
    expect(await s.query("SELECT count(*)::int AS n FROM auth_users")).toEqual([{ n: 0 }]);
    expect(await s.query("SELECT count(*)::int AS n FROM auth_credentials")).toEqual([{ n: 0 }]);
  });

  it("synchronizes roles exactly and never prunes assignments implicitly (AUTHZ-RBAC-005)", async () => {
    const { s, store: st } = await store();
    const base = {
      adapter: { backend: "express", database: "postgresql", orm: "prisma" },
    } as const;
    const v1 = parseConfig({
      ...base,
      authorization: {
        permissions: ["a.read", "a.write"],
        roles: { user: ["a.read"], editor: ["a.read", "a.write"] },
      },
    });
    await st.syncRoles(roleDefinitions(v1));
    await st.syncRoles(roleDefinitions(v1)); // idempotent
    expect((await st.getRolePermissions(["editor"])).sort()).toEqual(["a.read", "a.write"]);

    const v2 = parseConfig({
      ...base,
      authorization: { permissions: ["a.read", "a.write"], roles: { user: ["a.read", "a.write"] } },
    });
    await st.syncRoles(roleDefinitions(v2));
    expect((await st.getRolePermissions(["user"])).sort()).toEqual(["a.read", "a.write"]);
    // 'editor' is no longer configured but is kept: removing it is a reviewed migration.
    expect(await st.roleExists("editor")).toBe(true);
    expect(
      await s.query(
        "SELECT count(*)::int AS n FROM auth_role_permissions rp JOIN auth_roles r ON r.id = rp.role_id WHERE r.name = 'admin'",
      ),
    ).toEqual([{ n: 6 }]);
  });

  it("serializes rate-limit updates across application instances (SEC-RATE-006)", async () => {
    const { s } = await store();
    const clock = new ManualClock();
    // Two independent connection pools = two app instances sharing one database.
    const pools = [1, 2].map(() =>
      createPrismaClient({ connectionString: TEST_DATABASE_URL!, schema: s.schema, max: 5 }),
    );
    for (const p of pools) cleanup.push(() => p.$disconnect());
    const limiters = pools.map((p) => new RateLimiter(new PrismaRateLimitStore(p), clock));
    const rule = { limit: 5, windowSeconds: 900 };

    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        limiters[i % 2]!.hit("login:acct:victim@example.test", rule),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.filter((r) => r.justBlocked)).toHaveLength(1);
    expect((await limiters[0]!.check("login:acct:victim@example.test", rule)).allowed).toBe(false);
  });

  it("stores only token hashes and PHC strings", async () => {
    const sql = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
    expect(sql).not.toMatch(/\btoken\s+String\b/); // no raw token columns
  });
});
