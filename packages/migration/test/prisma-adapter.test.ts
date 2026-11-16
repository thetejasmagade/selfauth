import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PrismaMigrationAdapter, type CommandRunner } from "../src/index.js";

async function project(migrations: Record<string, string>, manifest?: object) {
  const cwd = await mkdtemp(join(tmpdir(), "selfauth-mig-"));
  await mkdir(join(cwd, "prisma", "migrations"), { recursive: true });
  await writeFile(join(cwd, "prisma", "schema.prisma"), "// schema");
  for (const [name, sql] of Object.entries(migrations)) {
    await mkdir(join(cwd, "prisma", "migrations", name));
    await writeFile(join(cwd, "prisma", "migrations", name, "migration.sql"), sql);
  }
  if (manifest) await writeFile(join(cwd, "selfauth.manifest.json"), JSON.stringify(manifest));
  return cwd;
}

const manifest = {
  toolkit: "selfauth",
  version: "0.0.0",
  specVersion: "0.1",
  database: { type: "postgresql", orm: "prisma" },
  ownedResources: { tables: ["auth_users"], types: [], migrations: ["20260101000000_init"] },
};

function fakePrisma(
  statusOutput: string,
  statusCode = 1,
  existingSql = "",
): { run: CommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: CommandRunner = async (args) => {
    calls.push(args);
    if (args[1] === "status") return { code: statusCode, stdout: statusOutput, stderr: "" };
    if (args[1] === "diff") return { code: 0, stdout: existingSql, stderr: "" };
    return { code: 0, stdout: "ok", stderr: "" };
  };
  return { run, calls };
}

const pendingOutput = (names: string[]) =>
  `2 migrations found in prisma/migrations\nFollowing migrations have not yet been applied:\n${names.join("\n")}\n\nTo apply migrations in development run prisma migrate dev.`;

describe("PrismaMigrationAdapter", () => {
  it("plans pending additive migrations without requiring approval and applies them", async () => {
    const cwd = await project(
      {
        "20260101000000_init": `CREATE TABLE "auth_users" (id uuid);`,
        "20260102000000_add": `ALTER TABLE "auth_users" ADD COLUMN "x" text;`,
      },
      manifest,
    );
    const { run, calls } = fakePrisma(pendingOutput(["20260102000000_add"]));
    const adapter = new PrismaMigrationAdapter({ cwd, run });
    const plan = await adapter.plan();
    expect(plan.pending.map((p) => p.name)).toEqual(["20260102000000_add"]);
    expect(plan.requiresApproval).toBe(false);
    const result = await adapter.migrate({ approveDestructive: false });
    expect(result.applied).toBe(true);
    expect(calls.at(-1)).toEqual(["migrate", "deploy"]);
  });

  it("refuses destructive plans unless approved", async () => {
    const cwd = await project(
      {
        "20260101000000_init": `CREATE TABLE "auth_users" (id uuid);`,
        "20260102000000_drop": `ALTER TABLE "auth_users" DROP COLUMN "email";`,
      },
      manifest,
    );
    const { run, calls } = fakePrisma(pendingOutput(["20260102000000_drop"]));
    const adapter = new PrismaMigrationAdapter({ cwd, run });
    const refused = await adapter.migrate({ approveDestructive: false });
    expect(refused.applied).toBe(false);
    expect(refused.plan.findings.map((f) => f.kind)).toEqual(["drop_column"]);
    expect(calls.some((c) => c[1] === "deploy")).toBe(false);
    expect((await adapter.migrate({ approveDestructive: true })).applied).toBe(true);
  });

  it("requires approval for changes to tables SelfAuth does not own", async () => {
    const cwd = await project(
      {
        "20260101000000_init": `CREATE TABLE "auth_users" (id uuid);`,
        "20260102000000_touch": `ALTER TABLE "orders" ADD COLUMN "user_id" uuid;`,
      },
      manifest,
    );
    const adapter = new PrismaMigrationAdapter({
      cwd,
      run: fakePrisma(pendingOutput(["20260102000000_touch"])).run,
    });
    const plan = await adapter.plan();
    expect(plan.requiresApproval).toBe(true);
    expect(plan.findings[0]).toMatchObject({ kind: "not_owned", object: "orders" });
  });

  it("validates the manifest against migrations", async () => {
    const cwd = await project(
      { "20260101000000_init": `CREATE TABLE "auth_users" (id uuid);` },
      {
        ...manifest,
        ownedResources: {
          tables: ["auth_users", "auth_sessions"],
          types: [],
          migrations: ["20260101000000_init", "x"],
        },
      },
    );
    const report = await new PrismaMigrationAdapter({ cwd, run: fakePrisma("", 0).run }).validate();
    expect(report.ok).toBe(false);
    expect(report.problems).toEqual([
      "owned table 'auth_sessions' is not created by any migration",
      "owned migration 'x' is missing",
    ]);
  });

  it("blocks migrations that would create objects that already exist, even with approval", async () => {
    const cwd = await project(
      { "20260101000000_init": `CREATE TABLE "auth_users" (id uuid);` },
      manifest,
    );
    const adapter = new PrismaMigrationAdapter({
      cwd,
      run: fakePrisma(
        pendingOutput(["20260101000000_init"]),
        1,
        `DROP TABLE "users";\nDROP TABLE "auth_users";`,
      ).run,
    });
    const plan = await adapter.plan();
    expect(plan.blocked).toBe(true);
    expect(plan.findings[0]).toMatchObject({ kind: "already_exists", object: "auth_users" });
    const result = await adapter.migrate({ approveDestructive: true });
    expect(result.applied).toBe(false);
    expect(result.reason).toMatch(/already exist/);
  });

  it("reports that rollback is not automatic", async () => {
    const cwd = await project({});
    expect(
      (await new PrismaMigrationAdapter({ cwd, run: fakePrisma("").run }).rollback()).automatic,
    ).toBe(false);
  });

  it("rejects unsafe migration names", async () => {
    const cwd = await project({});
    await expect(
      new PrismaMigrationAdapter({ cwd, run: fakePrisma("").run }).generate("x; rm -rf /"),
    ).rejects.toThrow();
  });
});
