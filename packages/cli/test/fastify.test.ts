import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig } from "@selfauth/spec";
import { describe, expect, it } from "vitest";
import { withoutMarkers } from "../src/dialect.js";
import {
  applyPlan,
  diagnose,
  inspect,
  planAdd,
  planInit,
  planUpgrade,
  preflightAdd,
  runValidation,
  type InitAnswers,
} from "../src/index.js";
import { INTEGRATIONS } from "../src/commands/list.js";

/**
 * `selfauth init --backend fastify` (Phase 10): the same core and stores as Express behind a
 * Fastify adapter, from its own tested reference app (apps/playground-fastify).
 */
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const answers = (
  database: InitAnswers["database"] = "memory",
  frontend: InitAnswers["frontend"] = "none",
): InitAnswers => ({
  name: "demo",
  backend: "fastify",
  database,
  frontend,
  permissions: ["orders.view"],
  appBaseUrl: "http://localhost:5173",
});
const temp = () => mkdtemp(join(tmpdir(), "selfauth-fastify-"));

describe("planInit --backend fastify", () => {
  it.each(["memory", "postgresql"] as const)(
    "copies the Fastify reference implementation byte for byte (%s)",
    async (database) => {
      const files = await planInit(answers(database));
      const templated = files.filter((f) => f.template.startsWith("fastify:"));
      expect(templated.length).toBeGreaterThanOrEqual(25);
      for (const f of templated) {
        const source = f.template.slice("fastify:".length);
        // Byte for byte, except PostgreSQL's store loses the dialect marker comments (dialect.ts).
        const reference = await readFile(join(REPO, source), "utf8");
        expect(f.content, f.path).toBe(
          f.path === "src/auth/stores/prisma.ts" ? withoutMarkers(reference) : reference,
        );
      }
      expect(files.some((f) => f.template.startsWith("express:"))).toBe(false);
      expect(new Set(files.map((f) => f.path)).size).toBe(files.length);
    },
  );

  it("generates the Fastify adapter, not the Express one", async () => {
    const paths = (await planInit(answers())).map((f) => f.path);
    expect(paths).toContain("src/auth/fastify/index.ts");
    expect(paths).not.toContain("src/auth/express/index.ts");
    expect(paths).toContain("test/auth.smoke.test.ts");
  });

  it("depends on fastify and not on express", async () => {
    const files = await planInit(answers("postgresql"));
    const pkg = JSON.parse(files.find((f) => f.path === "package.json")!.content);
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps).toContain("fastify");
    expect(deps.filter((d) => d.includes("express"))).toEqual([]);
    const reference = JSON.parse(
      await readFile(join(REPO, "apps/playground-fastify/package.json"), "utf8"),
    );
    expect(pkg.dependencies.fastify).toBe(reference.dependencies.fastify);
  });

  it("writes a valid configuration and records the backend in the manifest", async () => {
    const files = await planInit(answers("postgresql"));
    const config = files.find((f) => f.path === "src/config/selfauth.config.ts")!.content;
    const literal = JSON.parse(config.slice(config.indexOf("= ") + 2, config.lastIndexOf(";")));
    expect(parseConfig(literal)).toEqual(literal);
    expect(literal.adapter).toMatchObject({ backend: "fastify", orm: "prisma" });
    const manifest = JSON.parse(files.find((f) => f.path === "selfauth.manifest.json")!.content);
    expect(manifest.options.backend).toBe("fastify");
    expect(manifest.ownedResources.tables).toContain("auth_users");
  });

  it("makes a full-stack project of two packages, with the Fastify API in server/", async () => {
    const paths = (await planInit(answers("postgresql", "vue"))).map((f) => f.path);
    expect(paths).toContain("server/src/auth/fastify/index.ts");
    expect(paths.some((p) => /notes/i.test(p))).toBe(false);
    expect(paths).toContain("client/vite.config.ts");
    expect(paths).not.toContain("server/src/auth/express/index.ts");
  });

  it("describes the Fastify project in its README", async () => {
    const readme = (await planInit(answers())).find((f) => f.path === "README.md")!.content;
    expect(readme).toContain("Fastify");
    expect(readme).toContain("fastify/");
  });

  it("is Express when no backend is given (existing callers)", async () => {
    const rest: InitAnswers = { ...answers() };
    delete rest.backend;
    const files = await planInit(rest);
    expect(files.map((f) => f.path)).toContain("src/auth/express/index.ts");
    const manifest = JSON.parse(files.find((f) => f.path === "selfauth.manifest.json")!.content);
    expect(manifest.options.backend).toBe("express");
  });
});

describe("a generated Fastify project", () => {
  it("is up to date for upgrade, and passes doctor and validate", async () => {
    const dir = await temp();
    await applyPlan(dir, await planInit(answers()));
    const plan = await planUpgrade(dir);
    expect(plan.items.filter((i) => i.status !== "unchanged")).toEqual([]);
    expect((await diagnose(dir)).errors).toEqual([]);
    const report = await runValidation(dir);
    expect(report.problems).toEqual([]);
  });

  it("is a supported project for detect (it is not an unsupported framework)", async () => {
    const dir = await temp();
    await applyPlan(dir, await planInit(answers()));
    const report = await inspect(dir);
    expect(report.recommendation).toBe("upgrade");
    expect(report.project.otherFrameworks).toEqual([]);
  });

  it("is a full-stack workspace that upgrades cleanly in both packages", async () => {
    const dir = await temp();
    await applyPlan(dir, await planInit(answers("memory", "react")));
    for (const pkg of ["server", "client"]) {
      const plan = await planUpgrade(join(dir, pkg));
      expect(
        plan.items.filter((i) => i.status !== "unchanged"),
        pkg,
      ).toEqual([]);
    }
    expect(existsSync(join(dir, "server/src/auth/fastify/index.ts"))).toBe(true);
  });
});

describe("existing Fastify projects (selfauth add)", () => {
  async function existingFastify(srcDir = "src") {
    const dir = await temp();
    const { mkdir, writeFile } = await import("node:fs/promises");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        type: "module",
        dependencies: { fastify: "^5.0.0" },
        devDependencies: { typescript: "~6.0.3" },
      }),
    );
    await writeFile(join(dir, "tsconfig.json"), '{ "compilerOptions": { "module": "NodeNext" } }');
    await writeFile(join(dir, ".gitignore"), ".env\nnode_modules\n");
    await mkdir(join(dir, srcDir), { recursive: true });
    await writeFile(
      join(dir, srcDir, "app.ts"),
      'import Fastify from "fastify";\nexport const app = Fastify();\n',
    );
    return dir;
  }

  it("are accepted by preflight and recommended `add` by detect", async () => {
    const dir = await existingFastify();
    const check = await preflightAdd(dir, { database: "memory" });
    expect(check.errors).toEqual([]);
    const report = await inspect(dir);
    expect(report.recommendation).toBe("add");
    expect(report.project.framework).toBe("fastify");
    expect(report.project.otherFrameworks).toEqual([]);
    expect(report.layout).toMatchObject({ entryFile: "src/app.ts", sourceDir: "src" });
    expect(report.options.map((o) => o.command)).toEqual([
      "selfauth add --database memory --backend fastify",
      "selfauth add --database postgresql --backend fastify",
      "selfauth add --database mysql --backend fastify",
      "selfauth add --database sqlite --backend fastify",
    ]);
  });

  it("finds the source folder from the Fastify entry file", async () => {
    const report = await inspect(await existingFastify("server"));
    expect(report.layout).toMatchObject({ entryFile: "server/app.ts", sourceDir: "server" });
  });

  it("are given the Fastify adapter and a setup file, and nothing of the Express one", async () => {
    const dir = await existingFastify();
    const files = await planAdd({ ...answers(), frontend: "none" });
    const paths = files.map((f) => f.path);
    expect(paths).toContain("src/selfauth/setup.ts");
    expect(paths).toContain("src/selfauth/auth/fastify/index.ts");
    expect(paths.some((p) => p.includes("/express/"))).toBe(false);
    expect(paths).not.toContain("src/selfauth/app.ts");
    const setup = files.find((f) => f.path === "src/selfauth/setup.ts")!.content;
    expect(setup).toContain("export async function setupSelfAuth(app: FastifyInstance)");
    expect(setup).not.toContain("express");
    const manifest = JSON.parse(files.find((f) => f.path === "selfauth.manifest.json")!.content);
    expect(manifest.options).toMatchObject({ layout: "add", backend: "fastify" });

    await applyPlan(dir, files);
    expect(existsSync(join(dir, "src/selfauth/setup.ts"))).toBe(true);
    const plan = await planUpgrade(dir);
    expect(plan.items.filter((i) => i.status !== "unchanged")).toEqual([]);
    expect((await diagnose(dir)).errors).toEqual([]);
  });

  it("keeps Express as the backend when both frameworks are listed", async () => {
    const dir = await existingFastify();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        type: "module",
        dependencies: { express: "^5.0.0", fastify: "^5.0.0" },
        devDependencies: { typescript: "~6.0.3" },
      }),
    );
    expect((await inspect(dir)).project.framework).toBe("express");
  });
});

describe("selfauth list", () => {
  it("offers Fastify for new projects and for `selfauth add`", () => {
    const fastify = INTEGRATIONS.find((i) => i.id === "fastify")!;
    expect(fastify.kind).toBe("backend");
    expect(fastify.add).toBe(true);
    expect(INTEGRATIONS.find((i) => i.id === "express")!.add).toBe(true);
  });
});
