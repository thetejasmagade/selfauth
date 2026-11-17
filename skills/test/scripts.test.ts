import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPlan, planInit } from "@selfauth/cli";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPTS = join(REPO, "skills", "selfauth", "scripts");
const env = { ...process.env, SELFAUTH_CLI: join(REPO, "packages", "cli", "dist", "bin.js") };
const temp = () => mkdtemp(join(tmpdir(), "selfauth-skill-"));

function script(name: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((done) => {
    execFile(process.execPath, [join(SCRIPTS, name), ...args], { env }, (error, stdout) =>
      done({ code: error ? Number(error.code ?? 1) : 0, stdout }),
    );
  });
}

async function project(files: Record<string, string>): Promise<string> {
  const dir = await temp();
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

const EXPRESS = {
  "package.json": JSON.stringify({
    type: "module",
    dependencies: { express: "^5.3.0" },
    devDependencies: { typescript: "~6.0.3" },
  }),
  "tsconfig.json": '{ "compilerOptions": { "module": "NodeNext" } }',
};

async function selfauthProject(): Promise<string> {
  const dir = await temp();
  await applyPlan(
    dir,
    await planInit({
      name: "demo",
      database: "memory",
      frontend: "none",
      permissions: ["orders.view"],
      appBaseUrl: "http://localhost:5173",
    }),
  );
  return dir;
}

describe("detect-project.ts", () => {
  it("recommends init for an empty directory", async () => {
    const r = await script("detect-project.ts", [await temp(), "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).recommendation).toBe("init");
  });

  it("recommends add for an Express project and lists tsconfig changes", async () => {
    const r = await script("detect-project.ts", [await project(EXPRESS)]);
    expect(r.stdout).toContain("**Recommendation: add**");
    expect(r.stdout).toContain("available: `selfauth add --database memory`");
    expect(r.stdout).toContain("rewriteRelativeImportExtensions");
    expect(r.stdout).toContain("No authentication code found");
  });

  it("shows existing authentication with file:line evidence and asks for approval", async () => {
    const dir = await project({
      ...EXPRESS,
      "package.json": JSON.stringify({
        type: "module",
        dependencies: { express: "^5.3.0", jsonwebtoken: "^9" },
        devDependencies: { typescript: "~6.0.3" },
      }),
      "src/middleware/auth.ts":
        "import jwt from 'jsonwebtoken';\n\nexport const v = (t: string) => jwt.verify(t, 'k');\n",
      "src/routes.ts": "router.post('/api/login', handler);\n",
      "node_modules/passport/index.js": "passport.use(x)\n", // dependencies are not scanned
    });
    const r = await script("detect-project.ts", [dir]);
    expect(r.stdout).toContain("Existing auth packages: jsonwebtoken");
    expect(r.stdout).toContain("src/middleware/auth.ts:3 (JWT sign/verify)");
    expect(r.stdout).toContain("src/routes.ts:1 (auth route)");
    expect(r.stdout).not.toContain("node_modules");
    expect(r.stdout).toContain("--allow-existing-auth");
    expect(r.stdout).toMatch(/only with the developer's approval/);
  });

  it.each([
    ["Fastify", { "package.json": '{ "dependencies": { "fastify": "^5" } }' }, "fastify"],
    ["NestJS", { "package.json": '{ "dependencies": { "@nestjs/core": "^11" } }' }, "@nestjs/core"],
    ["Django", { "requirements.txt": "django\n" }, "python"],
  ])("refuses unsupported stacks (%s)", async (_name, files, found) => {
    const r = await script("detect-project.ts", [await project(files), "--json"]);
    const report = JSON.parse(r.stdout);
    expect(report.recommendation).toBe("unsupported");
    expect(report.reason).toContain(found);
    expect(report.options.every((o: { available: boolean }) => !o.available)).toBe(true);
  });

  it("reports blockers instead of guessing (CommonJS project, existing Prisma schema)", async () => {
    const dir = await project({
      "package.json": JSON.stringify({
        dependencies: { express: "^5", "@prisma/client": "^7" },
        devDependencies: { typescript: "~6.0.3", prisma: "^7" },
      }),
      "tsconfig.json": '{ "compilerOptions": { "module": "NodeNext" } }',
      "prisma/schema.prisma": 'datasource db {\n  provider = "postgresql"\n}\n',
    });
    const report = JSON.parse((await script("detect-project.ts", [dir, "--json"])).stdout);
    expect(report.project.prismaProvider).toBe("postgresql");
    expect(report.recommendation).toBe("unsupported");
    const pg = report.options.find((o: { command: string }) => o.command.includes("postgresql"));
    expect(pg.blockers.join(" ")).toMatch(/already uses Prisma/);
    expect(pg.blockers.join(" ")).toMatch(/"type": "module"/);
  });

  it("recommends upgrade when SelfAuth is installed", async () => {
    const report = JSON.parse(
      (await script("detect-project.ts", [await selfauthProject(), "--json"])).stdout,
    );
    expect(report.recommendation).toBe("upgrade");
  });

  it("finds the source folder when the code is not in src/", async () => {
    const dir = await project({
      "package.json": EXPRESS["package.json"],
      "tsconfig.json": '{ "compilerOptions": { "module": "NodeNext" }, "include": ["server"] }',
      "server/index.ts": 'import express from "express";\nexpress();\n',
    });
    const r = await script("detect-project.ts", [dir]);
    expect(r.stdout).toContain("**Recommendation: add**");
    expect(r.stdout).toContain("Source folder for `add`: `server`");
    expect(r.stdout).toContain("available: `selfauth add --database memory --src server`");
  });

  it("sends a monorepo root to its packages and a Vue app to add-frontend", async () => {
    const root = await project({
      "package.json": '{ "private": true, "workspaces": ["apps/*"] }',
      "apps/api/package.json": EXPRESS["package.json"],
      "apps/web/package.json": '{ "dependencies": { "vue": "^3.5.0", "vue-router": "^4.5.0" } }',
    });
    const monorepo = await script("detect-project.ts", [root]);
    expect(monorepo.stdout).toContain("**Recommendation: workspace**");
    expect(monorepo.stdout).toContain("`apps/api`: backend (express)");
    expect(monorepo.stdout).toContain("`apps/web`: frontend (vue)");
    expect(monorepo.stdout).toContain("available: `selfauth add-frontend apps/web`");

    const web = await script("detect-project.ts", [join(root, "apps/web")]);
    expect(web.stdout).toContain("**Recommendation: add-frontend**");
    expect(web.stdout).toContain("selfauth add-frontend --frontend vue");
    expect(web.stdout).toMatch(/SelfAuth generates no pages/);
  });

  it("fails clearly when the CLI cannot be found", async () => {
    const r = await new Promise<{ code: number; stderr: string }>((done) =>
      execFile(
        process.execPath,
        [join(SCRIPTS, "detect-project.ts"), REPO],
        { env: { ...process.env, SELFAUTH_CLI: "/nonexistent/bin.js" } },
        (error, _stdout, stderr) => done({ code: Number(error?.code ?? 0), stderr }),
      ),
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("SELFAUTH_CLI");
  });
});

describe("validate-auth.ts", () => {
  it("passes a valid project and reports unverified checks as SKIPPED", async () => {
    const r = await script("validate-auth.ts", [await selfauthProject()]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("PASS    selfauth validate");
    expect(r.stdout).toContain("PASS    selfauth doctor");
    expect(r.stdout).toContain("WARN    doctor warning — in-memory store");
    expect(r.stdout).toContain(
      "SKIPPED backend: typecheck, test, build — dependencies not installed",
    );
    expect(r.stdout).toContain("SKIPPED live HTTP probes");
    expect(r.stdout).toMatch(/RESULT: PASS — 2 check\(s\) SKIPPED: not verified/);
  });

  it("fails outside a SelfAuth project", async () => {
    const r = await script("validate-auth.ts", [await project(EXPRESS), "--json"]);
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.result).toBe("FAIL");
    expect(report.checks[0]).toMatchObject({ name: "selfauth validate", status: "FAIL" });
  });

  it("fails when a generated security file was deleted", async () => {
    const dir = await selfauthProject();
    const { rm } = await import("node:fs/promises");
    await rm(join(dir, "src", "auth", "core", "crypto.ts"));
    const r = await script("validate-auth.ts", [dir]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("generated file missing: src/auth/core/crypto.ts");
  });

  it("runs the project's own scripts and fails on a failing one", async () => {
    const dir = await selfauthProject();
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    pkg.scripts = { typecheck: 'node -e "process.exit(3)"', test: 'node -e ""' };
    await writeFile(join(dir, "package.json"), JSON.stringify(pkg));
    await mkdir(join(dir, "node_modules"));
    const report = JSON.parse((await script("validate-auth.ts", [dir, "--json"])).stdout);
    const status = (name: string) =>
      report.checks.find((c: { name: string }) => c.name === name)?.status;
    expect(status("backend: typecheck")).toBe("FAIL");
    expect(status("backend: test")).toBe("PASS");
    expect(status("backend: build")).toBe("SKIPPED");
    expect(report.result).toBe("FAIL");
  });

  describe("live probes", () => {
    let server: Server;
    let url = "";
    let unguarded = false;
    const send = (res: ServerResponse, status: number, code: string) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code, message: code, requestId: "r" } }));
    };
    beforeAll(async () => {
      server = createServer((req, res) => {
        if (req.url === "/auth/logout" && req.method === "POST") {
          return req.headers["x-selfauth-csrf"]
            ? send(res, 204, "")
            : send(res, 403, "CSRF_FAILED");
        }
        if (req.url === "/api/orders" && unguarded) {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end("[]");
        }
        send(res, 401, "UNAUTHENTICATED");
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const address = server.address() as { port: number };
      url = `http://127.0.0.1:${address.port}`;
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    it("pass when auth routes, CSRF and the named routes refuse anonymous requests", async () => {
      unguarded = false;
      const r = await script("validate-auth.ts", [
        await selfauthProject(),
        "--url",
        url,
        "--protected",
        "/api/orders",
      ]);
      expect(r.stdout).toContain("PASS    GET /auth/me without a session");
      expect(r.stdout).toContain("PASS    POST /auth/logout without the CSRF header");
      expect(r.stdout).toContain("PASS    GET /api/orders without a session");
      expect(r.code).toBe(0);
    });

    it("fail when a route the agent says is protected answers anonymously", async () => {
      unguarded = true;
      const r = await script("validate-auth.ts", [
        await selfauthProject(),
        "--url",
        url,
        "--protected",
        "/api/orders",
      ]);
      expect(r.stdout).toContain("FAIL    GET /api/orders without a session — 200");
      expect(r.stdout).toContain("RESULT: FAIL");
      expect(r.code).toBe(1);
    });

    it("fail when the server is not running", async () => {
      const r = await script("validate-auth.ts", [
        await selfauthProject(),
        "--url",
        "http://127.0.0.1:9",
      ]);
      expect(r.stdout).toMatch(/FAIL {4}GET \/auth\/me without a session — request failed/);
      expect(r.code).toBe(1);
    });
  });
});
