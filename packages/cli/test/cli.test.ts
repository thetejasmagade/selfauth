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
const answers = (
  database: InitAnswers["database"],
  frontend: InitAnswers["frontend"] = "none",
): InitAnswers => ({
  name: "demo",
  database,
  frontend,
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
    const memStore = (await planInit(answers("memory"))).find((f) => f.path === "src/db/store.ts")!;
    expect(memStore.content).not.toContain("prisma");
  });

  it("renders a valid configuration and records every file's hash in the manifest", async () => {
    const files = await planInit(answers("postgresql"));
    const config = files.find((f) => f.path === "src/config/selfauth.config.ts")!.content;
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
      for (const frontend of ["none", "vue", "react"] as const) {
        for (const f of stackFiles({ database: db, frontend })) {
          expect(existsSync(join(REPO, f.source)), f.source).toBe(true);
        }
      }
    }
  });
});

describe("planInit with a frontend", () => {
  it.each(["vue", "react"] as const)(
    "copies the %s reference frontend into client/ byte for byte",
    async (frontend) => {
      const files = await planInit(answers("postgresql", frontend));
      const web = files.filter((f) => f.template.startsWith(`${frontend}:`));
      expect(web.length).toBeGreaterThan(15);
      for (const f of web) {
        expect(f.path.startsWith("client/"), f.path).toBe(true);
        expect(f.content, f.path).toBe(
          await readFile(join(REPO, f.template.slice(frontend.length + 1)), "utf8"),
        );
      }
      // The backend ships the notes example the frontend uses.
      expect(files.map((f) => f.path)).toContain("server/src/routes/notes.ts");
      expect(files.find((f) => f.path === "server/src/routes/index.ts")!.content).toContain(
        "mountNotes",
      );
    },
  );

  it("configures the example permissions, frontend origin and client package", async () => {
    const files = await planInit(answers("memory", "react"));
    const config = files.find((f) => f.path === "server/src/config/selfauth.config.ts")!.content;
    const literal = JSON.parse(config.slice(config.indexOf("= ") + 2, config.lastIndexOf(";")));
    expect(literal.adapter.frontend).toBe("react");
    expect(literal.authorization.permissions).toEqual([
      "orders.view",
      "orders.create",
      "notes.create",
      "notes.view",
      "notes.view_any",
    ]);
    expect(literal.authorization.roles.support).toEqual(["notes.view_any"]);

    const web = JSON.parse(files.find((f) => f.path === "client/package.json")!.content);
    const reference = JSON.parse(
      await readFile(join(REPO, "apps/playground-react/package.json"), "utf8"),
    );
    expect(web.dependencies.react).toBe(reference.dependencies.react);
    expect(web.devDependencies.vite).toBe(reference.devDependencies.vite);
    expect(
      Object.keys({ ...web.dependencies, ...web.devDependencies }).some((d) =>
        d.startsWith("@selfauth/"),
      ),
    ).toBe(false);

    // Two packages, each with its own manifest (paths relative to the package).
    const manifest = (dir: string) =>
      JSON.parse(files.find((f) => f.path === `${dir}/selfauth.manifest.json`)!.content);
    expect(manifest("server").options).toMatchObject({
      layout: "server",
      frontend: "react",
      structure: 3,
    });
    expect(manifest("client").options).toMatchObject({
      layout: "client",
      frontend: "react",
      structure: 3,
    });
    expect(files.some((f) => f.path === "selfauth.manifest.json")).toBe(false);
  });

  it("keeps the hello example, and a flat project, without a frontend", async () => {
    const files = await planInit(answers("memory"));
    expect(files.map((f) => f.path)).not.toContain("src/routes/notes.ts");
    expect(files.some((f) => f.path.startsWith("web/") || f.path.startsWith("client/"))).toBe(
      false,
    );
    expect(files.some((f) => f.path.startsWith("server/"))).toBe(false);
    const manifest = JSON.parse(files.find((f) => f.path === "selfauth.manifest.json")!.content);
    expect(manifest.options).toMatchObject({ layout: "project", structure: 2 });
  });

  it("makes a full-stack project a workspace of two packages", async () => {
    const files = await planInit(answers("postgresql", "vue"));
    const paths = files.map((f) => f.path);
    // Nothing of the backend or frontend sits at the root except the workspace files.
    const rootFiles = paths.filter((p) => !p.includes("/"));
    expect(rootFiles.sort()).toEqual([".gitignore", "README.md", "package.json"]);
    const root = JSON.parse(files.find((f) => f.path === "package.json")!.content);
    expect(root.workspaces).toEqual(["server", "client"]);
    expect(root.scripts.dev).toContain("concurrently");
    expect(root.scripts["db:create-admin"]).toBe("npm run db:create-admin -w server --");
    expect(
      JSON.parse(files.find((f) => f.path === "server/package.json")!.content).scripts,
    ).not.toHaveProperty("dev:web");
    // A pattern with a slash in the middle is anchored at the .gitignore, so it must be **/.
    expect(files.find((f) => f.path === ".gitignore")!.content).toContain("**/src/generated/");
    expect(paths).toContain("server/.env.example");
    expect(paths).toContain("server/prisma/schema.prisma");
    expect(paths).toContain("client/vite.config.ts");
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
    const path = join(dir, "src/config/selfauth.config.ts");
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
      /you changed 2 generated file\(s\): .*\.gitignore.*src\/config\/selfauth\.config\.ts/,
    );
  });

  it("reports invalid configuration as errors", async () => {
    const dir = await project();
    const path = join(dir, "src/config/selfauth.config.ts");
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace('"minLength": 8', '"minLength": 4'),
    );
    expect((await diagnose(dir)).errors.join("\n")).toMatch(/minLength/);
  });

  it("recognises a directory that is not a SelfAuth project", async () => {
    expect((await diagnose(await temp())).errors).toEqual([
      "not a SelfAuth project (selfauth.manifest.json not found)",
    ]);
  });
});
