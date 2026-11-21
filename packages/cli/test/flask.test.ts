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

/**
 * `selfauth init --backend flask`: the Python reference application (apps/playground-flask, held to
 * the conformance suite on every database), copied into a new project and composed per database.
 * Any database; with a frontend it becomes server/ + client/.
 */
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const REFERENCE = "apps/playground-flask";
const DATABASES = ["memory", "postgresql", "mysql", "sqlite", "mongodb"] as const;
const answers = (
  database: InitAnswers["database"] = "postgresql",
  extra: Partial<InitAnswers> = {},
): InitAnswers => ({
  name: "demo",
  backend: "flask",
  database,
  frontend: "none",
  permissions: ["orders.view"],
  appBaseUrl: "http://localhost:5173",
  ...extra,
});
const temp = () => mkdtemp(join(tmpdir(), "selfauth-flask-"));
const text = (files: { path: string; content: string }[], path: string) =>
  files.find((f) => f.path === path)!.content;

describe("planInit --backend flask", () => {
  it.each(DATABASES)(
    "copies the Python reference implementation unchanged (%s)",
    async (database) => {
      const files = await planInit(answers(database));
      const templated = files.filter((f) => f.template.startsWith("flask:"));
      expect(templated.length).toBeGreaterThanOrEqual(30);
      for (const f of templated) {
        const reference = await readFile(join(REPO, f.template.slice("flask:".length)), "utf8");
        expect(f.content, f.path).toBe(reference);
      }
      expect(new Set(files.map((f) => f.path)).size).toBe(files.length);
    },
  );

  it("is a Python project: no Node files, no Prisma, no other backend", async () => {
    const paths = (await planInit(answers())).map((f) => f.path);
    for (const absent of ["package.json", "tsconfig.json", "prisma/schema.prisma", "go.mod"])
      expect(paths).not.toContain(absent);
    expect(paths).toEqual(
      expect.arrayContaining([
        "app/wsgi.py",
        "app/auth/service.py",
        "app/flask_auth.py",
        "app/cmd/server.py",
        "requirements.txt",
        "requirements-dev.txt",
        "pytest.ini",
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

  it("is composed per database: only that database's store, runner and schema are generated", async () => {
    const stores = {
      postgresql: ["app/store/sqlstore.py", "app/store/dialect.py", "app/store/migrations.py"],
      mysql: ["app/store/sqlstore.py", "app/store/dialect.py", "app/store/migrations.py"],
      sqlite: ["app/store/sqlstore.py", "app/store/dialect.py", "app/store/migrations.py"],
      mongodb: ["app/store/mongostore.py"],
    } as const;
    const all = new Set(Object.values(stores).flat());
    for (const database of DATABASES) {
      const paths = (await planInit(answers(database))).map((f) => f.path);
      const mine: readonly string[] = database === "memory" ? [] : stores[database];
      for (const path of all)
        expect(paths.includes(path), `${database}: ${path}`).toBe(mine.includes(path));
      // The shared parts are always there.
      for (const shared of ["app/store/__init__.py", "app/store/memory.py", "app/store/errors.py"])
        expect(paths).toContain(shared);
      for (const command of ["migrate", "seed", "create_admin"])
        expect(paths.includes(`app/cmd/${command}.py`)).toBe(database !== "memory");
      expect(paths.some((p) => p.startsWith("db/migrations/"))).toBe(
        ["postgresql", "mysql", "sqlite"].includes(database),
      );
    }
  });

  it("installs only the chosen database's driver", async () => {
    const wanted = {
      memory: null,
      postgresql: "psycopg[binary]",
      mysql: "PyMySQL",
      sqlite: null,
      mongodb: "pymongo",
    } as const;
    const drivers = ["psycopg", "PyMySQL", "pymongo"];
    for (const database of DATABASES) {
      const requirements = text(await planInit(answers(database)), "requirements.txt");
      expect(requirements).toContain("flask");
      expect(requirements).toContain("argon2-cffi");
      for (const driver of drivers)
        expect(requirements.includes(driver), `${database}: ${driver}`).toBe(
          wanted[database] !== null && wanted[database].startsWith(driver),
        );
    }
  });

  it("writes the schema derived for MySQL and SQLite as db/migrations", async () => {
    const sql = (files: { path: string; content: string }[]) =>
      files.find((f) => /^db\/migrations\/[^/]+\/migration\.sql$/.test(f.path))!.content;
    const mysql = await planInit(answers("mysql"));
    const sqlite = await planInit(answers("sqlite"));
    expect(sql(mysql)).toContain("CHAR(36)");
    expect(sql(sqlite)).toContain('"auth_users"');
    expect(sql(sqlite)).not.toContain("CHAR(36)");
    expect([...mysql, ...sqlite].some((f) => f.path.endsWith("migration_lock.toml"))).toBe(false);
  });

  it("writes a valid configuration and records the backend and no ORM in the manifest", async () => {
    const files = await planInit(answers("postgresql"));
    const config = JSON.parse(text(files, "selfauth.config.json"));
    expect(parseConfig(config)).toEqual(config);
    expect(config.adapter).toEqual({
      backend: "flask",
      frontend: "none",
      database: "postgresql",
      orm: "none",
    });
    expect(config.authorization.permissions).toEqual(["orders.view"]);
    const manifest = JSON.parse(text(files, "selfauth.manifest.json"));
    expect(manifest.options).toMatchObject({ backend: "flask", structure: 2 });
    expect(manifest.options.module).toBeUndefined();
    expect(manifest.database).toEqual({ type: "postgresql", orm: "none" });
    expect(manifest.ownedResources.tables).toContain("auth_users");
    expect(manifest.files.length).toBe(files.length - 1);
  });

  it("points DATABASE_URL at the chosen database", async () => {
    for (const [database, prefix] of [
      ["postgresql", "postgresql://"],
      ["mysql", "mysql://"],
      ["sqlite", "file:"],
      ["mongodb", "mongodb://"],
    ] as const) {
      expect(text(await planInit(answers(database)), ".env.example")).toContain(
        `DATABASE_URL=${prefix}`,
      );
    }
    expect(text(await planInit(answers("memory")), ".env.example")).not.toContain("DATABASE_URL");
  });

  it("describes the Python project in its README, .env.example and .gitignore", async () => {
    const files = await planInit(answers());
    const readme = text(files, "README.md");
    expect(readme).toContain("python -m app.cmd.server");
    expect(readme).toContain("python -m app.cmd.migrate up");
    expect(readme).toContain("pip install -r requirements-dev.txt");
    expect(readme).not.toContain("npm run");
    expect(readme).not.toContain("go run");
    const env = text(files, ".env.example");
    expect(env).toContain("APP_ENV=development");
    expect(env).not.toContain("NODE_ENV");
    expect(text(files, ".gitignore")).toMatch(/^\.env$/m);
    expect(text(files, ".gitignore")).toMatch(/^\.venv\/$/m);
  });

  it("writes placeholders only into .env.example (SEC-SECRET-002)", async () => {
    const env = text(await planInit(answers()), ".env.example");
    const values = env
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => l.split("=")[1] ?? "");
    expect(values.join(" ")).not.toMatch(/[A-Za-z0-9_-]{32,}/);
    expect(env).toContain("user:password@");
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
      await readFile(join(REPO, REFERENCE, "tests/testdata/default.json"), "utf8"),
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

describe("a generated Flask project", () => {
  it("is up to date for upgrade, and passes doctor and validate", async () => {
    const dir = await temp();
    await applyPlan(dir, await planInit(answers("postgresql")));
    const plan = await planUpgrade(dir);
    expect(plan.items.filter((i) => i.status !== "unchanged")).toEqual([]);
    const report = await diagnose(dir);
    expect(report.errors).toEqual([]);
    // The mailer is the one thing the developer must still provide.
    expect(report.warnings.join("\n")).toContain("implement create_mailer in app/mailer.py");
    expect((await runValidation(dir)).problems).toEqual([]);
  });

  it("warns when revealExistingEmail is on (SEC-ENUM-004)", async () => {
    const dir = await temp();
    await applyPlan(dir, await planInit(answers()));
    const path = join(dir, "selfauth.config.json");
    const config = JSON.parse(await readFile(path, "utf8"));
    config.authentication.registration.revealExistingEmail = true;
    await writeFile(path, JSON.stringify(config));
    expect((await diagnose(dir)).warnings.join("\n")).toMatch(/SEC-ENUM-004/);
  });

  it("notices an edited configuration that breaks the schema", async () => {
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

  it("leaves your edits alone when upgrading", async () => {
    const dir = await temp();
    await applyPlan(dir, await planInit(answers("memory")));
    const mailer = join(dir, "app/mailer.py");
    await writeFile(mailer, `${await readFile(mailer, "utf8")}\n# mine\n`);
    const plan = await planUpgrade(dir);
    expect(plan.items.find((i) => i.path === "app/mailer.py")!.status).toBe("kept");
    expect(plan.items.filter((i) => i.status === "update" || i.status === "conflict")).toEqual([]);
  });

  it("is an installed SelfAuth project for detect, not an unsupported language", async () => {
    const dir = await temp();
    await applyPlan(dir, await planInit(answers()));
    expect((await inspect(dir)).recommendation).toBe("upgrade");
  });

  it("is refused by init when the folder already has Python project files", async () => {
    for (const file of ["pyproject.toml", "requirements.txt"]) {
      const dir = await temp();
      await writeFile(join(dir, file), "\n");
      expect(await init(dir, { backend: "flask", database: "memory", yes: true })).toBe(1);
    }
  });
});

describe("existing Python projects and selfauth list", () => {
  it("are reported as unsupported by detect, pointing at `init --backend flask`", async () => {
    const dir = await temp();
    await writeFile(join(dir, "requirements.txt"), "flask\n");
    const report = await inspect(dir);
    expect(report.recommendation).toBe("unsupported");
    expect(JSON.stringify(report)).toContain("init --backend flask");
  });

  it("offers Flask for new projects only", () => {
    const flask = INTEGRATIONS.find((i) => i.id === "flask")!;
    expect(flask.kind).toBe("backend");
    expect(flask.add).toBe(false);
  });

  it("rejects --module, which is for Go", async () => {
    const dir = await temp();
    expect(
      await init(dir, { backend: "flask", database: "memory", module: "x/y", yes: true }),
    ).toBe(1);
  });
});

describe.each(["vue", "react"] as const)("init --backend flask --frontend %s", (frontend) => {
  for (const database of DATABASES) {
    it(`plans server/, client/ and a workspace root (${database})`, async () => {
      const appBaseUrl = frontend === "vue" ? "http://localhost:5173" : "http://localhost:5174";
      const files = await planInit(
        answers(database, { name: "shop", frontend, appBaseUrl, permissions: ["orders.view"] }),
      );
      const paths = files.map((f) => f.path);
      expect(new Set(paths).size).toBe(paths.length);

      // The Python application is under server/, with its own requirements and tests.
      for (const p of [
        "server/app/wsgi.py",
        "server/requirements.txt",
        "server/pytest.ini",
        "server/selfauth.config.json",
        "server/.env.example",
        "server/tests/test_app.py",
      ])
        expect(paths).toContain(p);
      expect(paths.some((p) => p.startsWith("server/db/migrations/"))).toBe(
        ["postgresql", "mysql", "sqlite"].includes(database),
      );

      // The frontend is under client/, without the notes demo the reference app carries.
      expect(paths).toContain("client/package.json");
      expect(paths).toContain("client/src/auth/client.ts");
      expect(paths.some((p) => /NotesPage/.test(p))).toBe(false);

      // The root only runs the two: npm for the client, Python for the server.
      const root = JSON.parse(text(files, "package.json"));
      expect(root.workspaces).toEqual(["client"]);
      expect(root.scripts["dev:server"]).toBe("node scripts/dev-server.mjs");
      expect("db:migrate" in root.scripts).toBe(database !== "memory");
      const dev = text(files, "scripts/dev-server.mjs");
      expect(dev).toContain(`"${appBaseUrl}"`);
      expect(dev).toContain("app.cmd.");

      // Each package has its own manifest, so doctor, validate, diff and upgrade work in both.
      const server = JSON.parse(text(files, "server/selfauth.manifest.json"));
      const client = JSON.parse(text(files, "client/selfauth.manifest.json"));
      expect(server.options).toMatchObject({ layout: "server", backend: "flask", frontend });
      expect(server.database.orm).toBe("none");
      expect(client.options).toMatchObject({ layout: "client", frontend });
      expect(server.files.every((f: { path: string }) => !f.path.startsWith("server/"))).toBe(true);
    });
  }
});
