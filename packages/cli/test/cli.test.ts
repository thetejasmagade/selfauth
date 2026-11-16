import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig } from "@selfauth/spec";
import { describe, expect, it } from "vitest";
import {
  applyPlan,
  buildConfig,
  ConflictError,
  detectProject,
  diagnose,
  fileDrift,
  loadManifest,
  planInit,
  sha256,
  stackFiles,
  type InitAnswers,
} from "../src/index.js";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const answers = (database: InitAnswers["database"]): InitAnswers => ({
  name: "demo",
  database,
  permissions: ["orders.view", "orders.create"],
  appBaseUrl: "http://localhost:5173",
});
const temp = () => mkdtemp(join(tmpdir(), "selfauth-cli-"));

describe("planInit", () => {
  it.each(["memory", "postgresql"] as const)(
    "copies the tested reference implementation byte for byte (%s)",
    async (db) => {
      const files = await planInit(answers(db));
      const templated = files.filter((f) => f.template.startsWith("express:"));
      expect(templated.length).toBeGreaterThanOrEqual(25);
      for (const f of templated) {
        const source = f.template.slice("express:".length);
        expect(f.content, f.path).toBe(await readFile(join(REPO, source), "utf8"));
      }
      expect(new Set(files.map((f) => f.path)).size).toBe(files.length); // no duplicate targets
    },
  );

  it("selects database-specific files", async () => {
    const mem = (await planInit(answers("memory"))).map((f) => f.path);
    const pg = (await planInit(answers("postgresql"))).map((f) => f.path);
    expect(mem).not.toContain("prisma/schema.prisma");
    expect(mem).not.toContain("src/auth/stores/prisma.ts");
    expect(pg).toContain("prisma/schema.prisma");
    expect(pg.some((p) => p.startsWith("prisma/migrations/") && p.endsWith("migration.sql"))).toBe(
      true,
    );
    const memStore = (await planInit(answers("memory"))).find((f) => f.path === "src/store.ts")!;
    expect(memStore.content).not.toContain("prisma");
  });

  it("renders a valid configuration and records every file's hash in the manifest", async () => {
    const files = await planInit(answers("postgresql"));
    const config = files.find((f) => f.path === "src/selfauth.config.ts")!.content;
    const literal = JSON.parse(config.slice(config.indexOf("= ") + 2, config.lastIndexOf(";")));
    expect(parseConfig(literal)).toEqual(literal);
    expect(literal.authorization.permissions).toEqual(["orders.view", "orders.create"]);
    expect(literal.adapter).toMatchObject({ database: "postgresql", orm: "prisma" });

    const manifest = JSON.parse(files.find((f) => f.path === "selfauth.manifest.json")!.content);
    expect(manifest.ownedResources.tables).toContain("auth_users");
    for (const f of files.filter((x) => x.path !== "selfauth.manifest.json")) {
      expect(manifest.files).toContainEqual({
        path: f.path,
        template: f.template,
        sha256: sha256(f.content),
      });
    }
  });

  it("pins the dependency versions the reference implementation was tested with", async () => {
    const pkg = JSON.parse(
      (await planInit(answers("postgresql"))).find((f) => f.path === "package.json")!.content,
    );
    const playground = JSON.parse(
      await readFile(join(REPO, "apps/playground/package.json"), "utf8"),
    );
    expect(pkg.dependencies["@node-rs/argon2"]).toBe(playground.dependencies["@node-rs/argon2"]);
    expect(pkg.dependencies["@prisma/client"]).toBe(playground.dependencies["@prisma/client"]);
    expect(Object.keys(pkg.dependencies).some((d) => d.startsWith("@selfauth/"))).toBe(false); // no runtime SelfAuth dependency
  });

  it("never registers a template file that does not exist", () => {
    for (const db of ["memory", "postgresql"] as const) {
      for (const f of stackFiles(db)) expect(existsSync(join(REPO, f.source)), f.source).toBe(true);
    }
  });
});

describe("buildConfig", () => {
  it("rejects malformed and reserved permissions", () => {
    expect(() => buildConfig({ ...answers("memory"), permissions: ["orders"] })).toThrow(
      /invalid permission/,
    );
    expect(() => buildConfig({ ...answers("memory"), permissions: ["auth.users.manage"] })).toThrow(
      /invalid permission/,
    );
  });
});

describe("applyPlan", () => {
  it("writes into an empty directory", async () => {
    const dir = await temp();
    await applyPlan(dir, await planInit(answers("memory")));
    expect(existsSync(join(dir, "src/auth/core/service.ts"))).toBe(true);
    const manifest = (await loadManifest(dir))!;
    expect(await fileDrift(dir, manifest)).toMatchObject({ modified: [], missing: [] });
  });

  it("refuses to overwrite anything and writes nothing on conflict", async () => {
    const dir = await temp();
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/app.ts"), "// mine");
    await writeFile(join(dir, "README.md"), "# mine");
    const error = await applyPlan(dir, await planInit(answers("memory"))).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).paths.sort()).toEqual(["README.md", "src/app.ts"]);
    expect((await readdir(dir)).sort()).toEqual(["README.md", "src"]);
    expect(await readFile(join(dir, "src/app.ts"), "utf8")).toBe("// mine");
  });
});

describe("detectProject", () => {
  it("detects frameworks, package managers and existing authentication", async () => {
    const dir = await temp();
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { express: "5", passport: "1" },
        devDependencies: { typescript: "6", prisma: "7" },
      }),
    );
    await writeFile(join(dir, "pnpm-lock.yaml"), "");
    expect(await detectProject(dir)).toMatchObject({
      hasPackageJson: true,
      framework: "express",
      typescript: true,
      prisma: true,
      packageManager: "pnpm",
      existingAuth: ["passport"],
      selfauth: false,
    });
    expect(await detectProject(join(dir, "missing"))).toMatchObject({ exists: false, empty: true });
  });
});

describe("diagnose (selfauth doctor)", () => {
  async function project() {
    const dir = await temp();
    await applyPlan(dir, await planInit(answers("memory")));
    return dir;
  }

  it("reports a fresh project's production gaps as warnings", async () => {
    const report = await diagnose(await project());
    expect(report.errors).toEqual([]);
    expect(report.warnings.join("\n")).toMatch(/in-memory store/);
    expect(report.warnings.join("\n")).toMatch(/createMailer/);
  });

  it("flags risky configuration, missing env and secrets hygiene", async () => {
    const dir = await project();
    const path = join(dir, "src/selfauth.config.ts");
    const text = await readFile(path, "utf8");
    await writeFile(
      path,
      text
        .replace('"revealExistingEmail": false', '"revealExistingEmail": true')
        .replace('"name": "__Host-session"', '"name": "dev_session"')
        .replace('"secure": true', '"secure": false'),
    );
    await writeFile(join(dir, ".gitignore"), "node_modules/\n");
    await writeFile(join(dir, ".env"), "PORT=3000\n");
    const report = await diagnose(dir);
    expect(report.warnings.join("\n")).toMatch(/SEC-ENUM-004/);
    expect(report.warnings.join("\n")).toMatch(/cookie.secure is false/);
    expect(report.errors.join("\n")).toMatch(/\.env is not git-ignored/);
    expect(report.errors.join("\n")).toMatch(/SELFAUTH_APP_BASE_URL is missing/);
    expect(report.notes.join("\n")).toMatch(
      /you changed 2 generated file\(s\): .*\.gitignore.*src\/selfauth\.config\.ts/,
    );
  });

  it("reports invalid configuration as errors", async () => {
    const dir = await project();
    const path = join(dir, "src/selfauth.config.ts");
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace('"minLength": 12', '"minLength": 4'),
    );
    expect((await diagnose(dir)).errors.join("\n")).toMatch(/minLength/);
  });

  it("recognises a directory that is not a SelfAuth project", async () => {
    expect((await diagnose(await temp())).errors).toEqual([
      "not a SelfAuth project (selfauth.manifest.json not found)",
    ]);
  });
});
