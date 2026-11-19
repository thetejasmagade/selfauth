import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createdObjects } from "@selfauth/migration";
import { parseConfig } from "@selfauth/spec";
import { describe, expect, it } from "vitest";
import {
  applyPlan,
  diagnose,
  inspect,
  planInit,
  planUpgrade,
  runValidation,
  type InitAnswers,
} from "../src/index.js";
import { init } from "../src/commands/init.js";
import { INTEGRATIONS } from "../src/commands/list.js";
import { sortGoImports } from "../src/plan.js";
import { GO_REFERENCE_MODULE } from "../src/templates.js";

/**
 * `selfauth init --backend gin`: the Go reference application (apps/playground-gin, held to the
 * conformance suite on memory and PostgreSQL), copied into a new project with its module path
 * replaced. Any database; with a frontend it becomes server/ + client/.
 */
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const REFERENCE = "apps/playground-gin";
const answers = (
  database: InitAnswers["database"] = "postgresql",
  extra: Partial<InitAnswers> = {},
): InitAnswers => ({
  name: "demo",
  backend: "gin",
  database,
  frontend: "none",
  permissions: ["orders.view"],
  appBaseUrl: "http://localhost:5173",
  ...extra,
});
const temp = () => mkdtemp(join(tmpdir(), "selfauth-gin-"));
const text = (files: { path: string; content: string }[], path: string) =>
  files.find((f) => f.path === path)!.content;

describe("planInit --backend gin", () => {
  it.each(["memory", "postgresql"] as const)(
    "copies the Go reference implementation, changing only the module path (%s)",
    async (database) => {
      const files = await planInit(answers(database, { module: "github.com/acme/demo" }));
      const templated = files.filter((f) => f.template.startsWith("gin:"));
      expect(templated.length).toBeGreaterThanOrEqual(35);
      for (const f of templated) {
        const reference = await readFile(join(REPO, f.template.slice("gin:".length)), "utf8");
        const renamed = reference
          .replace("module example.com/app\n", "module github.com/acme/demo\n")
          .replaceAll(`"${GO_REFERENCE_MODULE}/`, '"github.com/acme/demo/');
        expect(f.content, f.path).toBe(
          f.path.endsWith(".go")
            ? sortGoImports(renamed)
            : f.path === "go.mod"
              ? renamed
              : reference,
        );
      }
      // No import of the reference module survives.
      expect(
        files.filter((f) => f.path.endsWith(".go") && f.content.includes("example.com/app")),
      ).toEqual([]);
      expect(text(files, "go.mod")).toMatch(/^module github\.com\/acme\/demo$/m);
      expect(new Set(files.map((f) => f.path)).size).toBe(files.length);
    },
  );

  it("writes gofmt-clean Go whatever the module name sorts like", async () => {
    const { spawnSync } = await import("node:child_process");
    if (spawnSync("gofmt", ["-h"]).error) return; // gofmt not installed: CI runs it
    const dir = await mkdtemp(join(tmpdir(), "selfauth-gofmt-"));
    for (const module of ["notes-app", "zzz/app", "aaa.example/app"]) {
      const files = await planInit(answers("postgresql", { module }));
      const { mkdir } = await import("node:fs/promises");
      for (const f of files.filter((f) => f.path.endsWith(".go"))) {
        const path = join(dir, module.replace(/\W/g, "_"), f.path);
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, f.content);
      }
      const result = spawnSync("gofmt", ["-l", join(dir, module.replace(/\W/g, "_"))], {
        encoding: "utf8",
      });
      expect(result.stdout.trim(), module).toBe("");
    }
  });

  it("sorts each import group by path, as gofmt does", () => {
    expect(
      sortGoImports(
        'package x\n\nimport (\n\t"os"\n\t"context"\n\n\t"zz/app/b"\n\tauthx "zz/app/a"\n\t"github.com/x/y"\n)\n',
      ),
    ).toBe(
      'package x\n\nimport (\n\t"context"\n\t"os"\n\n\t"github.com/x/y"\n\tauthx "zz/app/a"\n\t"zz/app/b"\n)\n',
    );
  });

  it("is a Go project: no Node files, no Prisma, no other backend", async () => {
    const paths = (await planInit(answers())).map((f) => f.path);
    for (const absent of ["package.json", "tsconfig.json", "prisma/schema.prisma", "src/app.ts"])
      expect(paths).not.toContain(absent);
    expect(paths).toEqual(
      expect.arrayContaining([
        "cmd/server/main.go",
        "internal/auth/service.go",
        "internal/ginauth/ginauth.go",
        "selfauth.config.json",
        "selfauth.manifest.json",
        ".env.example",
        ".gitignore",
        "README.md",
      ]),
    );
    // The conformance harness and its TypeScript driver stay in the SelfAuth repository.
    expect(paths.filter((p) => p.startsWith("test/"))).toEqual([]);
  });

  it("defaults the module path to the project name", async () => {
    const files = await planInit(answers());
    expect(text(files, "go.mod")).toMatch(/^module demo$/m);
    expect(text(files, "cmd/server/main.go")).toContain('"demo/internal/app"');
  });

  it("gives PostgreSQL projects the database commands and migrations, memory ones neither", async () => {
    const pg = (await planInit(answers("postgresql"))).map((f) => f.path);
    expect(pg).toEqual(
      expect.arrayContaining([
        "cmd/migrate/main.go",
        "cmd/seed/main.go",
        "cmd/create-admin/main.go",
        "db/migrations/20261116085533_selfauth_init/migration.sql",
      ]),
    );
    const memory = (await planInit(answers("memory"))).map((f) => f.path);
    expect(
      memory.filter((p) => p.startsWith("db/") || /^cmd\/(migrate|seed|create)/.test(p)),
    ).toEqual([]);
    expect(memory).toContain("internal/store/store.go");
  });

  it("writes a valid configuration and records the backend, module and no ORM in the manifest", async () => {
    const files = await planInit(answers("postgresql", { module: "acme/demo" }));
    const config = JSON.parse(text(files, "selfauth.config.json"));
    expect(parseConfig(config)).toEqual(config);
    expect(config.adapter).toEqual({
      backend: "gin",
      frontend: "none",
      database: "postgresql",
      orm: "none",
    });
    expect(config.authorization.permissions).toEqual(["orders.view"]);
    const manifest = JSON.parse(text(files, "selfauth.manifest.json"));
    expect(manifest.options).toMatchObject({ backend: "gin", module: "acme/demo", structure: 2 });
    expect(manifest.database).toEqual({ type: "postgresql", orm: "none" });
    expect(manifest.ownedResources.tables).toContain("auth_users");
    expect(manifest.files.length).toBe(files.length - 1);
  });

  it("is composed per database: only that database's store, runner and schema are generated", async () => {
    const stores = {
      postgresql: ["internal/store/postgres/postgres.go", "internal/store/register_postgres.go"],
      mysql: ["internal/store/sqlstore/sqlstore.go", "internal/store/register_mysql.go"],
      sqlite: ["internal/store/sqlstore/sqlstore.go", "internal/store/register_sqlite.go"],
      mongodb: ["internal/store/mongostore/mongostore.go", "internal/store/register_mongodb.go"],
    } as const;
    const all = new Set(Object.values(stores).flat());
    for (const database of ["postgresql", "mysql", "sqlite", "mongodb", "memory"] as const) {
      const paths = (await planInit(answers(database))).map((f) => f.path);
      const mine: readonly string[] = database === "memory" ? [] : stores[database];
      for (const path of all)
        expect(paths.includes(path), `${database}: ${path}`).toBe(mine.includes(path));
      // The shared parts are always there.
      expect(paths).toContain("internal/store/store.go");
      expect(paths).toContain("internal/store/driver.go");
      expect(paths).toContain("internal/store/memory/memory.go");
      expect(paths.includes("cmd/migrate/main.go")).toBe(database !== "memory");
    }
  });

  it("writes the schema derived for MySQL and SQLite as db/migrations", async () => {
    const mysql = await planInit(answers("mysql"));
    const sqlite = await planInit(answers("sqlite"));
    const sql = (files: { path: string; content: string }[]) =>
      files.find((f) => /^db\/migrations\/[^/]+\/migration\.sql$/.test(f.path))!.content;
    expect(sql(mysql)).toContain("CHAR(36)");
    expect(sql(sqlite)).toContain('"auth_users"');
    expect(sql(sqlite)).not.toContain("CHAR(36)");
    // Prisma's lock file means nothing to the Go runner.
    expect([...mysql, ...sqlite].some((f) => f.path.endsWith("migration_lock.toml"))).toBe(false);
    // MongoDB has no schema folder.
    expect((await planInit(answers("mongodb"))).some((f) => f.path.startsWith("db/"))).toBe(false);
  });

  it("points DATABASE_URL at the chosen database", async () => {
    for (const [database, prefix] of [
      ["mysql", "mysql://"],
      ["sqlite", "file:"],
      ["mongodb", "mongodb://"],
    ] as const) {
      const env = text(await planInit(answers(database)), ".env.example");
      expect(env).toContain(`DATABASE_URL=${prefix}`);
    }
  });

  it("describes the Go project in its README, .env.example and .gitignore", async () => {
    const files = await planInit(answers());
    const readme = text(files, "README.md");
    expect(readme).toContain("go run ./cmd/server");
    expect(readme).toContain("go run ./cmd/migrate up");
    expect(readme).not.toContain("npm run");
    const env = text(files, ".env.example");
    expect(env).toContain("APP_ENV=development");
    expect(env).toContain("DATABASE_URL=postgresql://");
    expect(env).not.toContain("NODE_ENV");
    expect(text(files, ".gitignore")).toMatch(/^\.env$/m);
  });
});

describe("the reference application and its generated defaults agree", () => {
  it("ships the configuration `init` generates for its own choices", async () => {
    const generated = JSON.parse(
      text(await planInit(answers("postgresql", { permissions: [] })), "selfauth.config.json"),
    );
    const reference = JSON.parse(
      await readFile(join(REPO, REFERENCE, "selfauth.config.json"), "utf8"),
    );
    expect(reference).toEqual(generated);
    // Tests read this copy so they keep checking the defaults when a project edits its own config.
    const testdata = JSON.parse(
      await readFile(join(REPO, REFERENCE, "internal/config/testdata/default.json"), "utf8"),
    );
    expect(testdata).toEqual(reference);
  });

  it("lists exactly the objects its migrations create (the ownership manifest)", async () => {
    const manifest = JSON.parse(
      await readFile(join(REPO, REFERENCE, "selfauth.manifest.json"), "utf8"),
    );
    const sql = await readFile(
      join(REPO, REFERENCE, "db/migrations/20261116085533_selfauth_init/migration.sql"),
      "utf8",
    );
    const created = createdObjects(sql);
    expect([...manifest.ownedResources.tables].sort()).toEqual([...created.tables].sort());
    expect([...manifest.ownedResources.types].sort()).toEqual([...created.types].sort());
  });
});

describe("a generated Gin project", () => {
  it("is up to date for upgrade, and passes doctor and validate", async () => {
    const dir = await temp();
    await applyPlan(dir, await planInit(answers("postgresql", { module: "acme/demo" })));
    const plan = await planUpgrade(dir);
    expect(plan.items.filter((i) => i.status !== "unchanged")).toEqual([]);
    const report = await diagnose(dir);
    expect(report.errors).toEqual([]);
    // The mailer is the one thing the developer must still provide.
    expect(report.warnings.join("\n")).toContain("implement NewMailer in internal/email/mailer.go");
    expect((await runValidation(dir)).problems).toEqual([]);
  });

  it("notices an edited configuration that breaks the schema, and a deleted file", async () => {
    const dir = await temp();
    await applyPlan(dir, await planInit(answers()));
    const path = join(dir, "selfauth.config.json");
    const broken = JSON.parse(await readFile(path, "utf8"));
    broken.authentication.password.minLength = 2;
    await writeFile(path, JSON.stringify(broken));
    const report = await runValidation(dir);
    expect(report.ok).toBe(false);
    expect(report.problems.join("\n")).toMatch(/minLength/);
  });

  it("keeps the module path when upgrading, and leaves your edits alone", async () => {
    const dir = await temp();
    await applyPlan(dir, await planInit(answers("memory", { module: "acme/demo" })));
    const mailer = join(dir, "internal/email/mailer.go");
    await writeFile(mailer, `${await readFile(mailer, "utf8")}\n// mine\n`);
    const plan = await planUpgrade(dir);
    expect(plan.items.find((i) => i.path === "internal/email/mailer.go")!.status).toBe("kept");
    expect(plan.items.filter((i) => i.status === "update" || i.status === "conflict")).toEqual([]);
  });

  it("is an installed SelfAuth project for detect, not an unsupported language", async () => {
    const dir = await temp();
    await applyPlan(dir, await planInit(answers()));
    expect((await inspect(dir)).recommendation).toBe("upgrade");
  });

  it("is refused by init when the folder already has a go.mod", async () => {
    const dir = await temp();
    await writeFile(join(dir, "go.mod"), "module x\n");
    expect(await init(dir, { backend: "gin", database: "memory", yes: true })).toBe(1);
  });
});

describe("existing Go projects and selfauth list", () => {
  it("are reported as unsupported by detect, pointing at `init --backend gin`", async () => {
    const dir = await temp();
    await writeFile(join(dir, "go.mod"), "module x\n");
    const report = await inspect(dir);
    expect(report.recommendation).toBe("unsupported");
    expect(JSON.stringify(report)).toContain("init --backend gin");
  });

  it("offers Gin for new projects only", () => {
    const gin = INTEGRATIONS.find((i) => i.id === "gin")!;
    expect(gin.kind).toBe("backend");
    expect(gin.add).toBe(false);
  });
});
