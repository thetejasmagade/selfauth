import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig } from "@selfauth/spec";
import { describe, expect, it } from "vitest";
import {
  applyPlan,
  diagnose,
  planInit,
  planUpgrade,
  runValidation,
  type InitAnswers,
} from "../src/index.js";
import { init } from "../src/commands/init.js";
import { INTEGRATIONS } from "../src/commands/list.js";

/**
 * `selfauth init --backend next` and `--frontend next`: the Next.js reference apps
 * (apps/playground-next, held to the conformance suite; apps/playground-next-web, held to the
 * browser suite) copied into a new project and composed per database. A Next.js backend with
 * Next.js pages is one package; every other combination is server/ + client/.
 */
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const DATABASES = ["memory", "postgresql", "mysql", "sqlite", "mongodb"] as const;
const answers = (
  database: InitAnswers["database"] = "postgresql",
  extra: Partial<InitAnswers> = {},
): InitAnswers => ({
  name: "demo",
  backend: "next",
  database,
  frontend: "none",
  permissions: ["orders.view"],
  appBaseUrl: "http://localhost:5173",
  ...extra,
});
const temp = () => mkdtemp(join(tmpdir(), "selfauth-next-"));
const text = (files: { path: string; content: string }[], path: string) =>
  files.find((f) => f.path === path)!.content;

describe("planInit --backend next", () => {
  it.each(DATABASES)("copies the reference implementation unchanged (%s)", async (database) => {
    const files = await planInit(answers(database));
    const templated = files.filter((f) => f.template.startsWith("next:"));
    expect(templated.length).toBeGreaterThanOrEqual(25);
    for (const f of templated) {
      const reference = await readFile(join(REPO, f.template.slice("next:".length)), "utf8");
      // The Prisma files of the derived databases and the schema are adapted; the rest are as is.
      if (!/prisma|migration|store\.ts|seed|create-admin|mailer/.test(f.path)) {
        expect(f.content, f.path).toBe(reference);
      }
    }
    expect(new Set(files.map((f) => f.path)).size).toBe(files.length);
  });

  it("is a Next.js project: the route handlers, SelfAuth's lib, no Express or Fastify files", async () => {
    const paths = (await planInit(answers())).map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "src/app/auth/[[...path]]/route.ts",
        "src/app/api/[[...path]]/route.ts",
        "src/app/api/hello/route.ts",
        "src/app/health/route.ts",
        "src/lib/auth.ts",
        "src/instrumentation.ts",
        "src/auth/next/index.ts",
        "next.config.ts",
        "test/auth.smoke.test.ts",
        "package.json",
        "tsconfig.json",
        "selfauth.manifest.json",
      ]),
    );
    for (const absent of [
      "src/app.ts",
      "src/server.ts",
      "src/routes/index.ts",
      "src/http/request-id.ts",
      "tsconfig.build.json",
      "src/auth/express/index.ts",
      "src/auth/fastify/index.ts",
      "src/app/notes/page.tsx",
      "src/app/api/notes/route.ts",
    ])
      expect(paths, absent).not.toContain(absent);
    // The API alone has no pages and no frontend module.
    expect(
      paths.some((p) => p.startsWith("src/screens/") || p.startsWith("src/auth-client/")),
    ).toBe(false);
    expect(paths).not.toContain("src/app/layout.tsx");
  });

  it("is composed per database", async () => {
    const stores = {
      memory: [],
      postgresql: ["src/auth/stores/prisma.ts", "prisma/schema.prisma"],
      mysql: ["src/auth/stores/prisma.ts", "prisma/schema.prisma"],
      sqlite: ["src/auth/stores/prisma.ts", "prisma/schema.prisma"],
      mongodb: ["src/auth/stores/mongoose.ts", "src/scripts/migrate.ts"],
    } as const;
    const all = new Set(Object.values(stores).flat());
    for (const database of DATABASES) {
      const paths = (await planInit(answers(database))).map((f) => f.path);
      for (const path of all)
        expect(paths.includes(path), `${database}: ${path}`).toBe(
          (stores[database] as readonly string[]).includes(path),
        );
      expect(paths.includes("src/scripts/seed.ts")).toBe(database !== "memory");
    }
  });

  it("installs Next.js, React and only the chosen database's packages", async () => {
    const wanted = {
      memory: [],
      postgresql: ["@prisma/adapter-pg", "pg"],
      mysql: ["@prisma/adapter-mariadb", "mariadb"],
      sqlite: ["@prisma/adapter-better-sqlite3", "better-sqlite3"],
      mongodb: ["mongoose"],
    } as const;
    for (const database of DATABASES) {
      const pkg = JSON.parse(text(await planInit(answers(database)), "package.json"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const name of ["next", "react", "react-dom", "cookie", "@node-rs/argon2"])
        expect(deps, `${database}: ${name}`).toHaveProperty(name);
      expect(deps).not.toHaveProperty("fastify");
      expect(deps).not.toHaveProperty("express");
      for (const name of wanted[database])
        expect(deps, `${database}: ${name}`).toHaveProperty(name);
      expect("@prisma/adapter-pg" in deps).toBe(database === "postgresql");
      expect("mongoose" in deps).toBe(database === "mongodb");
    }
  });

  it("uses Next.js's own scripts and a tsconfig Next.js leaves alone", async () => {
    const files = await planInit(answers("postgresql"));
    const pkg = JSON.parse(text(files, "package.json"));
    expect(pkg.scripts).toMatchObject({
      dev: "next dev",
      build: "next build",
      start: "next start",
      test: 'node --test "test/**/*.test.ts"',
      "db:migrate": "prisma migrate deploy",
    });
    expect(pkg.type).toBe("module");
    const tsconfig = JSON.parse(text(files, "tsconfig.json"));
    // What Next.js adds to a tsconfig the first time it runs: present, so it never rewrites the file.
    expect(tsconfig.compilerOptions).toMatchObject({
      allowJs: true,
      esModuleInterop: true,
      jsx: "react-jsx",
      plugins: [{ name: "next" }],
    });
    expect(tsconfig.include).toEqual(expect.arrayContaining([".next/types/**/*.ts"]));
  });

  it("writes a valid configuration with the proxy count Next.js needs", async () => {
    const files = await planInit(answers("postgresql"));
    const source = text(files, "src/config/selfauth.config.ts");
    expect(source).toContain('"backend": "next"');
    expect(source).toContain('"trustProxy": 1');
    expect(source).toContain("X-Forwarded-For"); // why, next to the setting
    const json = source.slice(source.indexOf("= {") + 2, source.lastIndexOf("};") + 1);
    const config = JSON.parse(json);
    expect(parseConfig(config)).toEqual(config);
    expect(config.adapter).toEqual({
      backend: "next",
      frontend: "none",
      database: "postgresql",
      orm: "prisma",
    });
    expect(config.authorization.permissions).toEqual(["orders.view"]);
  });

  it("records the backend in the manifest", async () => {
    const files = await planInit(answers("mongodb"));
    const manifest = JSON.parse(text(files, "selfauth.manifest.json"));
    expect(manifest.options).toMatchObject({
      backend: "next",
      frontend: "none",
      layout: "project",
    });
    expect(manifest.database).toEqual({ type: "mongodb", orm: "mongoose" });
    expect(manifest.files.length).toBe(files.length - 1);
  });

  it("has an .env.example without NODE_ENV (Next.js sets it) and with the right database URL", async () => {
    for (const [database, prefix] of [
      ["postgresql", "postgresql://"],
      ["mysql", "mysql://"],
      ["sqlite", "file:"],
      ["mongodb", "mongodb://"],
    ] as const) {
      const env = text(await planInit(answers(database)), ".env.example");
      expect(env).toContain(`DATABASE_URL=${prefix}`);
      expect(env).not.toContain("NODE_ENV=");
      expect(env).toContain("SELFAUTH_APP_BASE_URL=");
    }
    expect(text(await planInit(answers("memory")), ".env.example")).not.toContain("DATABASE_URL");
  });

  it("ignores Next.js's build output and local environment files", async () => {
    const ignore = text(await planInit(answers()), ".gitignore");
    expect(ignore).toMatch(/^\.next\/$/m);
    expect(ignore).toMatch(/^next-env\.d\.ts$/m);
    expect(ignore).toMatch(/^\.env$/m);
  });

  it("explains the routes, withAuth and the proxy count in the README", async () => {
    const readme = text(await planInit(answers()), "README.md");
    expect(readme).toContain("npm run dev");
    expect(readme).toContain("src/app/api/<name>/route.ts");
    expect(readme).toContain("withAuth");
    expect(readme).toContain("http.trustProxy");
    expect(readme).toContain("app/auth/[[...path]]/route.ts");
    expect(readme).not.toContain("src/routes/index.ts");
  });

  it("has a smoke test that calls the route handlers, and a hello route behind withAuth", async () => {
    const files = await planInit(answers("memory"));
    expect(text(files, "test/auth.smoke.test.ts")).toContain("src/app/auth/[[...path]]/route.ts");
    const hello = text(files, "src/app/api/hello/route.ts");
    expect(hello).toContain("withAuth");
    expect(hello).toContain("auth.protect(auth.requireAuth");
  });
});

describe("a Next.js backend with Next.js pages", () => {
  const full = (database: InitAnswers["database"] = "postgresql") =>
    answers(database, {
      frontend: "next",
      name: "shop",
      appBaseUrl: "http://localhost:3000",
    });

  it.each(DATABASES)(
    "is one package with the pages and the API side by side (%s)",
    async (database) => {
      const files = await planInit(full(database));
      const paths = files.map((f) => f.path);
      expect(new Set(paths).size).toBe(paths.length);
      // One package: no server/, client/, web/ or workspace root.
      for (const p of paths) expect(p, p).not.toMatch(/^(server|client|web)\//);
      expect(paths.filter((p) => p === "package.json")).toHaveLength(1);
      expect(paths.filter((p) => p === "next.config.ts")).toHaveLength(1);
      expect(paths).toEqual(
        expect.arrayContaining([
          "src/app/layout.tsx",
          "src/app/page.tsx",
          "src/app/login/page.tsx",
          "src/app/register/page.tsx",
          "src/app/verify-email/page.tsx",
          "src/app/forgot-password/page.tsx",
          "src/app/reset-password/page.tsx",
          "src/app/account/page.tsx",
          "src/auth-client/client.ts",
          "src/auth-client/react.tsx",
          "src/screens/auth/LoginScreen.tsx",
          "src/auth/next/index.ts", // the server's code does not collide with the browser's
          "src/app/auth/[[...path]]/route.ts",
        ]),
      );
      // The API keeps its own next.config.ts (database packages are not bundled), and the
      // browser-only forwarding of /auth and /api does not exist: the API is in this app.
      expect(paths).not.toContain("src/proxy.ts");
      expect(text(files, "next.config.ts")).toContain("serverExternalPackages");
      // No notes demo, as in every generated project.
      expect(paths.some((p) => /notes/i.test(p))).toBe(false);
      for (const p of paths.filter(
        (q) => q.startsWith("src/app/") || q.startsWith("src/screens/"),
      )) {
        expect(text(files, p), p).not.toContain('"/notes"');
        expect(text(files, p), p).not.toContain("/notes");
      }
      const manifest = JSON.parse(text(files, "selfauth.manifest.json"));
      expect(manifest.options).toMatchObject({
        backend: "next",
        frontend: "next",
        layout: "project",
      });
    },
  );

  it("has one package.json with both halves' packages and Next.js scripts", async () => {
    const pkg = JSON.parse(text(await planInit(full()), "package.json"));
    expect(pkg.name).toBe("shop");
    expect(pkg.scripts).toMatchObject({ dev: "next dev", build: "next build" });
    expect(pkg.workspaces).toBeUndefined();
    for (const name of ["next", "react", "react-dom", "@types/react", "@types/react-dom"]) {
      expect({ ...pkg.dependencies, ...pkg.devDependencies }).toHaveProperty(name);
    }
  });

  it("opens at the app's own address, in the config, the env example and the README", async () => {
    const files = await planInit(full());
    expect(text(files, ".env.example")).toContain("SELFAUTH_APP_BASE_URL=http://localhost:3000");
    expect(text(files, "README.md")).toContain("http://localhost:3000");
    expect(text(files, "README.md")).toContain("one Next.js app");
    expect(text(files, "src/config/selfauth.config.ts")).toContain('"frontend": "next"');
  });

  it("is up to date for upgrade, and passes doctor and validate", async () => {
    const dir = await temp();
    await applyPlan(dir, await planInit(full("memory")));
    const plan = await planUpgrade(dir);
    expect(plan.items.filter((i) => i.status !== "unchanged")).toEqual([]);
    const report = await diagnose(dir);
    expect(report.errors).toEqual([]);
    expect(report.warnings.join("\n")).toContain("createMailer()");
    expect((await runValidation(dir)).problems).toEqual([]);
  });
});

describe("a Next.js backend with a Vite frontend", () => {
  it.each(["vue", "react"] as const)(
    "is server/ (Next.js, no pages) + client/ (%s)",
    async (frontend) => {
      const appBaseUrl = frontend === "vue" ? "http://localhost:5173" : "http://localhost:5174";
      const files = await planInit(answers("postgresql", { frontend, name: "shop", appBaseUrl }));
      const paths = files.map((f) => f.path);
      expect(new Set(paths).size).toBe(paths.length);
      for (const p of [
        "server/package.json",
        "server/tsconfig.json",
        "server/next.config.ts",
        "server/src/app/auth/[[...path]]/route.ts",
        "server/src/lib/auth.ts",
        "server/.env.example",
        "server/selfauth.manifest.json",
        "client/package.json",
        "client/vite.config.ts",
        "client/selfauth.manifest.json",
        "package.json",
        ".gitignore",
      ])
        expect(paths, p).toContain(p);
      expect(paths).not.toContain("server/tsconfig.build.json");
      // The API half has no pages; the frontend is Vite's.
      expect(paths).not.toContain("server/src/app/layout.tsx");
      expect(paths.some((p) => p.startsWith("client/src/app/"))).toBe(false);
      const root = JSON.parse(text(files, "package.json"));
      expect(root.workspaces).toEqual(["server", "client"]);
      expect(text(files, ".gitignore")).toMatch(/^\.next\/$/m);
      const server = JSON.parse(text(files, "server/selfauth.manifest.json"));
      expect(server.options).toMatchObject({ layout: "server", backend: "next", frontend });
      expect(text(files, "README.md")).toContain("Next.js API");
    },
  );
});

describe("a Next.js frontend for another backend", () => {
  it.each(["express", "fastify"] as const)(
    "is server/ (%s) + client/ (Next.js) with a run-time proxy",
    async (backend) => {
      const files = await planInit(
        answers("postgresql", {
          backend,
          frontend: "next",
          name: "shop",
          appBaseUrl: "http://localhost:5175",
        }),
      );
      const paths = files.map((f) => f.path);
      expect(new Set(paths).size).toBe(paths.length);
      for (const p of [
        "server/src/server.ts",
        "client/package.json",
        "client/next.config.ts",
        "client/src/proxy.ts",
        "client/src/app/layout.tsx",
        "client/src/app/login/page.tsx",
        "client/src/auth-client/client.ts",
        "client/src/screens/auth/LoginScreen.tsx",
        "client/tsconfig.json",
        "client/selfauth.manifest.json",
      ])
        expect(paths, p).toContain(p);
      expect(paths.some((p) => /notes/i.test(p))).toBe(false);
      const client = JSON.parse(text(files, "client/package.json"));
      expect(client.scripts).toMatchObject({
        dev: "next dev --port 5175",
        build: "next build",
        start: "next start --port 5175",
      });
      expect(Object.keys(client.dependencies)).toEqual(
        expect.arrayContaining(["next", "react", "react-dom"]),
      );
      // The backend's address is read when a request arrives, so one build runs against any backend.
      expect(text(files, "client/src/proxy.ts")).toContain("SELFAUTH_API_TARGET");
      expect(text(files, "client/src/proxy.ts")).toContain(
        'matcher: ["/auth/:path*", "/api/:path*"]',
      );
      expect(text(files, ".gitignore")).toMatch(/^\.next\/$/m);
      const manifest = JSON.parse(text(files, "client/selfauth.manifest.json"));
      expect(manifest.options).toMatchObject({ layout: "client", frontend: "next", backend });
      expect(text(files, "README.md")).toContain("src/auth-client/");
    },
  );

  it.each(["gin", "flask"] as const)(
    "is the %s API plus a Next.js client in client/",
    async (backend) => {
      const files = await planInit(
        answers("memory", {
          backend,
          frontend: "next",
          name: "shop",
          appBaseUrl: "http://localhost:5175",
          ...(backend === "gin" ? { module: "shop" } : {}),
        }),
      );
      const paths = files.map((f) => f.path);
      for (const p of [
        "client/src/proxy.ts",
        "client/next.config.ts",
        "client/src/app/layout.tsx",
        "client/src/auth-client/client.ts",
        "package.json",
        "scripts/dev-server.mjs",
      ])
        expect(paths, p).toContain(p);
      expect(JSON.parse(text(files, "package.json")).workspaces).toEqual(["client"]);
      expect(text(files, ".gitignore")).toMatch(/^\.next\/$/m);
      expect(text(files, "README.md")).toContain("Next.js");
    },
  );
});

describe("selfauth init, add and list", () => {
  it("offers Next.js for new projects, as the backend and as the frontend", () => {
    const backend = INTEGRATIONS.find((i) => i.kind === "backend" && i.id === "next")!;
    const frontend = INTEGRATIONS.find((i) => i.kind === "frontend" && i.id === "next")!;
    expect(backend.add).toBe(false);
    expect(frontend.add).toBe(false);
  });

  it("accepts --backend next and --frontend next in a dry run", async () => {
    const dir = await temp();
    expect(
      await init(dir, {
        backend: "next",
        database: "memory",
        frontend: "next",
        yes: true,
        dryRun: true,
      }),
    ).toBe(0);
  });

  it("refuses to create over an existing package.json", async () => {
    const dir = await temp();
    await writeFile(join(dir, "package.json"), "{}\n");
    expect(await init(dir, { backend: "next", database: "memory", yes: true })).toBe(1);
  });
});
