import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig } from "@selfauth/spec";
import { describe, expect, it } from "vitest";
import {
  applyPlan,
  diagnose,
  inspect,
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
        expect(f.content, f.path).toBe(await readFile(join(REPO, source), "utf8"));
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
    expect(paths).toContain("server/src/routes/notes.ts");
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

describe("existing Fastify projects", () => {
  it("are pointed to `init --backend fastify`: `add` supports Express only", async () => {
    const dir = await temp();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        type: "module",
        dependencies: { fastify: "^5.0.0" },
        devDependencies: { typescript: "~6.0.3" },
      }),
    );
    const check = await preflightAdd(dir, { database: "memory", allowExistingAuth: false });
    expect(check.errors.join(" ")).toMatch(/Express only.*init --backend fastify/);
    const report = await inspect(dir);
    expect(report.recommendation).toBe("unsupported");
    expect(report.reason).toMatch(/init --backend fastify/);
  });
});

describe("selfauth list", () => {
  it("offers Fastify for new projects only", () => {
    const fastify = INTEGRATIONS.find((i) => i.id === "fastify")!;
    expect(fastify.kind).toBe("backend");
    expect(fastify.add).toBe(false);
    expect(INTEGRATIONS.find((i) => i.id === "express")!.add).toBe(true);
  });
});
