import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyPlan,
  diagnose,
  planAdd,
  planUpgrade,
  preflightAdd,
  type InitAnswers,
} from "../src/index.js";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const answers = (database: InitAnswers["database"] = "memory"): InitAnswers => ({
  name: "legacy",
  database,
  frontend: "none",
  permissions: ["reports.view"],
  appBaseUrl: "http://localhost:5173",
});

async function existingProject(pkg: Record<string, unknown> = {}, tsconfig?: string) {
  const dir = await mkdtemp(join(tmpdir(), "selfauth-add-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      type: "module",
      dependencies: { express: "^5.3.0" },
      devDependencies: { typescript: "~6.0.3" },
      ...pkg,
    }),
  );
  await writeFile(
    join(dir, "tsconfig.json"),
    tsconfig ??
      `{
  // comments and trailing commas are fine
  "compilerOptions": { "module": "NodeNext", "strict": true, },
}`,
  );
  await mkdir(join(dir, "src"));
  await writeFile(join(dir, "src/server.ts"), "// the app's own server\n");
  return dir;
}

describe("preflightAdd", () => {
  it("accepts an ESM Express + TypeScript project and lists missing tsconfig options", async () => {
    const report = await preflightAdd(await existingProject(), { database: "memory" });
    expect(report.errors).toEqual([]);
    expect(report.tsconfigChanges).toEqual({
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
    });
  });

  it.each([
    ["CommonJS", { type: "commonjs" }, /"type": "module"/],
    ["no Express", { dependencies: { fastify: "5" } }, /Express is not a dependency/],
    ["old TypeScript", { devDependencies: { typescript: "^5.4.0" } }, /5\.7\+ is needed/],
    ["no TypeScript", { devDependencies: {} }, /TypeScript is not a dependency/],
  ])("refuses %s", async (_name, pkg, message) => {
    const report = await preflightAdd(await existingProject(pkg), { database: "memory" });
    expect(report.errors.join("\n")).toMatch(message);
  });

  it("requires explicit consent when another auth library is installed", async () => {
    const pkg = { dependencies: { express: "^5", passport: "^0.7" } };
    expect(
      (await preflightAdd(await existingProject(pkg), { database: "memory" })).errors.join(),
    ).toMatch(/--allow-existing-auth/);
    const allowed = await preflightAdd(await existingProject(pkg), {
      database: "memory",
      allowExistingAuth: true,
    });
    expect(allowed.errors).toEqual([]);
    expect(allowed.warnings.join()).toMatch(/passport/);
  });

  it("does not try to merge into an existing Prisma schema", async () => {
    const pkg = { devDependencies: { typescript: "~6.0.3", prisma: "7" } };
    const report = await preflightAdd(await existingProject(pkg), { database: "postgresql" });
    expect(report.errors.join()).toMatch(/already uses Prisma/);
    expect((await preflightAdd(await existingProject(pkg), { database: "memory" })).errors).toEqual(
      [],
    );
  });

  it("refuses non-ESM module settings", async () => {
    const report = await preflightAdd(
      await existingProject({}, '{ "compilerOptions": { "module": "CommonJS" } }'),
      { database: "memory" },
    );
    expect(report.errors.join()).toMatch(/not an ES module target/);
  });
});

describe("planAdd", () => {
  it("writes only new files under src/selfauth/ (plus the manifest), copied from the reference implementation", async () => {
    const files = await planAdd(answers());
    for (const f of files) {
      expect(
        f.path === "selfauth.manifest.json" || f.path.startsWith("src/selfauth/"),
        f.path,
      ).toBe(true);
    }
    const paths = files.map((f) => f.path);
    expect(paths).toContain("src/selfauth/setup.ts");
    expect(paths).not.toContain("src/selfauth/app.ts"); // the app shell is the project's own
    expect(paths).not.toContain("src/selfauth/server.ts");
    for (const f of files.filter((x) => x.template.startsWith("express:"))) {
      expect(f.content, f.path).toBe(
        await readFile(join(REPO, f.template.slice("express:".length)), "utf8"),
      );
    }
  });

  it("points Prisma's generated client at the moved store for PostgreSQL", async () => {
    const files = await planAdd(answers("postgresql"));
    const schema = files.find((f) => f.path === "prisma/schema.prisma")!.content;
    expect(schema).toContain('output              = "../src/selfauth/generated/prisma"');
    expect(files.map((f) => f.path)).toContain("src/selfauth/auth/stores/prisma.ts");
  });

  it("leaves existing files alone, and doctor/validate/upgrade understand the layout", async () => {
    const dir = await existingProject();
    await applyPlan(dir, await planAdd(answers()));
    expect(await readFile(join(dir, "src/server.ts"), "utf8")).toBe("// the app's own server\n");
    expect(existsSync(join(dir, "src/selfauth/config/selfauth.config.ts"))).toBe(true);

    const report = await diagnose(dir);
    expect(report.errors.join()).not.toMatch(/selfauth.config.ts not found/);
    expect(report.warnings.join()).toMatch(/src\/selfauth\/email\/mailer.ts/);
    expect((await planUpgrade(dir)).items.every((i) => i.status === "unchanged")).toBe(true);
  });
});
