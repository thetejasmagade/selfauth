import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { databaseUrlProblems } from "../src/database-env.js";
import { diagnose, planUpgrade } from "../src/index.js";
import { applyPlan, planAdd, planInit } from "../src/plan.js";
import type { InitAnswers } from "../src/render.js";
import { stackDependencies } from "../src/templates.js";

/**
 * MongoDB has its own store (a Mongoose implementation, not derived from SQL): its files are
 * template variants. The conformance suite runs against it on a real MongoDB
 * (scripts/dialect-conformance.mjs mongodb); these tests pin down what the generator writes.
 */
const answers = (over: Partial<InitAnswers> = {}): InitAnswers => ({
  name: "demo",
  database: "mongodb",
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

describe.each(["express", "fastify"] as const)("planInit --database mongodb (%s)", (backend) => {
  it("generates the Mongoose store, db wiring and scripts, and nothing of Prisma", async () => {
    const files = await planInit(answers({ backend }));
    const paths = files.map((f) => f.path);
    for (const wanted of [
      "src/auth/stores/mongoose.ts",
      "src/db/store.ts",
      "src/scripts/migrate.ts",
      "src/scripts/seed.ts",
      "src/scripts/create-admin.ts",
    ]) {
      expect(paths).toContain(wanted);
    }
    expect(paths.some((p) => p.startsWith("prisma/") || p === "prisma.config.ts")).toBe(false);
    expect(paths).not.toContain("src/auth/stores/prisma.ts");
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("keeps lookups safe from query operators and uses no transactions", async () => {
    const store = file(await planInit(answers({ backend })), "src/auth/stores/mongoose.ts");
    expect(store).toContain("must be a string"); // keys are checked, an object would be an operator
    expect(store).not.toMatch(/startSession|withTransaction/);
    expect(store).toContain("partialFilterExpression"); // unique email, only for real addresses
  });

  it("refuses to start without the indexes, and never creates them at start-up", async () => {
    const files = await planInit(answers({ backend }));
    const start = file(files, "src/db/store.ts");
    expect(start).toContain("missingIndexes");
    expect(start).toContain("npm run db:migrate");
    expect(start).not.toContain("createIndexes");
    expect(file(files, "src/scripts/migrate.ts")).toContain("--plan");
  });

  it("describes a MongoDB project in its manifest, .env.example and package.json", async () => {
    const files = await planInit(answers({ backend }));
    const manifest = JSON.parse(file(files, "selfauth.manifest.json"));
    expect(manifest.database).toEqual({ type: "mongodb", orm: "mongoose" });
    expect(manifest.ownedResources.tables).toContain("auth_users");
    expect(manifest.ownedResources.migrations).toEqual([]);
    expect(file(files, ".env.example")).toContain("DATABASE_URL=mongodb://localhost:27017/app");
    const pkg = JSON.parse(file(files, "package.json"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps).toHaveProperty("mongoose");
    expect(deps).not.toHaveProperty("prisma");
    expect(deps).not.toHaveProperty("@prisma/client");
    expect(pkg.scripts["db:migrate"]).toContain("src/scripts/migrate.ts");
    expect(pkg.scripts).not.toHaveProperty("postinstall");
  });
});

describe("selfauth add --database mongodb", () => {
  it("writes the store and scripts under the SelfAuth folder, without a prisma folder", async () => {
    const files = await planAdd(answers(), undefined, { srcDir: "src" });
    const paths = files.map((f) => f.path);
    expect(paths).toContain("src/selfauth/auth/stores/mongoose.ts");
    expect(paths).toContain("src/selfauth/scripts/migrate.ts");
    expect(paths.some((p) => p.startsWith("prisma/"))).toBe(false);
  });
});

describe("connection string checks and dependencies", () => {
  it("expect a mongodb:// or mongodb+srv:// URL", () => {
    expect(databaseUrlProblems("mongodb://localhost:27017/app", "mongodb")).toEqual([]);
    expect(databaseUrlProblems("mongodb+srv://u:p@cluster.example.net/app", "mongodb")).toEqual([]);
    expect(databaseUrlProblems("postgresql://u:p@h/db", "mongodb")[0]).toMatch(/mongodb:\/\//);
  });
  it("lists mongoose as the one database dependency", () => {
    expect(stackDependencies("mongodb").dependencies).toContain("mongoose");
    expect(stackDependencies("mongodb").devDependencies).not.toContain("prisma");
  });
});

describe("a generated MongoDB project", () => {
  it("is up to date for upgrade and passes doctor", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "selfauth-mongodb-")), "app");
    await applyPlan(dir, await planInit(answers()));
    expect((await planUpgrade(dir)).items.filter((i) => i.status !== "unchanged")).toEqual([]);
    expect((await diagnose(dir)).errors).toEqual([]);
  });
});
