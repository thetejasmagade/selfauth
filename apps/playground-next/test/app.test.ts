import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PolicyRegistry } from "../src/auth/core/authorization.ts";
import { clientAddress } from "../src/auth/next/index.ts";
import { EnvError, loadEnv } from "../src/config/env.ts";
import { config as playgroundConfig } from "../src/config/selfauth.config.ts";
import { notesRoutes } from "../src/lib/notes.ts";
import { buildTestApp } from "./helpers.ts";
import { request } from "./http.ts";

const csrf = { "X-SelfAuth-CSRF": "1", "Sec-Fetch-Site": "same-origin" };
const PASSWORD = "correct horse battery staple";

describe("Next.js adapter", async () => {
  const { app } = await buildTestApp({
    mount: (router, auth) => {
      router.get(
        "/boom",
        auth.route(() => {
          throw new Error(
            "SELECT * FROM secrets WHERE token='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'",
          );
        }),
      );
    },
  });

  it("returns the spec error envelope for unknown routes", async () => {
    for (const path of ["/api/nope", "/auth/nope"]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: "NOT_FOUND", message: "Not found.", requestId: res.headers["x-request-id"] },
      });
    }
  });

  it("generates the request id itself and never reads it from a header (SEC-LOG-003)", async () => {
    const res = await request(app).get("/auth/me").set("X-Request-Id", "attacker-chosen");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not advertise the framework", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("treats a trailing slash as the same route", async () => {
    const res = await request(app)
      .post("/auth/login/")
      .set(csrf)
      .send({ email: "a@b.test", password: "x" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects bodies over the configured limit with PAYLOAD_TOO_LARGE (SEC-HTTP-003)", async () => {
    const res = await request(app)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .set(csrf)
      .send(JSON.stringify({ data: "x".repeat(17 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("enforces the body limit while streaming, not only from Content-Length", async () => {
    const t = await buildTestApp();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`{"data":"${"x".repeat(20 * 1024)}"}`));
        controller.close();
      },
    });
    const res = await t.app.fetch(
      new Request("https://app.example.test/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrf },
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(413);
  });

  it("rejects malformed JSON without echoing parser internals", async () => {
    const res = await request(app)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .set(csrf)
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|Unexpected token|at /);
  });

  it("requires a JSON content type when there is a body", async () => {
    const res = await request(app)
      .post("/auth/login")
      .set("Content-Type", "text/plain")
      .set(csrf)
      .send("hello");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("hides internals of unexpected errors and redacts the server log (SEC-LOG-002)", async () => {
    const t = await buildTestApp({
      mount: (router, auth) =>
        router.get(
          "/boom",
          auth.route(() => {
            throw new Error(
              "SELECT * FROM secrets WHERE token='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'",
            );
          }),
        ),
    });
    const res = await request(t.app).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|Error:/);
    expect(t.logs.lines.join("\n")).toContain("unhandled error");
    expect(t.logs.lines.join("\n")).not.toContain("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  });

  it("renders errors thrown from another copy of the error classes", async () => {
    // Next.js can load a module once per route, so `instanceof` cannot be relied on.
    const t = await buildTestApp({
      mount: (router, auth) =>
        router.get(
          "/copy",
          auth.route(() => {
            const error = new Error("Not yours.");
            error.name = "AuthError";
            throw Object.assign(error, { code: "FORBIDDEN" });
          }),
        ),
    });
    const res = await request(t.app).get("/copy");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("denies a protected route that no guard allowed (AUTHZ-CORE-001)", async () => {
    const t = await buildTestApp({
      mount: (router, auth) =>
        router.post(
          "/open",
          auth.protect(() => Response.json({ ok: true })),
        ),
    });
    const email = "carol@example.test";
    await request(t.app).post("/auth/register").set(csrf).send({ email, password: PASSWORD });
    await request(t.app)
      .post("/auth/email/verify")
      .set(csrf)
      .send({ token: t.mailer.lastTo(email)!.token });
    const login = await request(t.app)
      .post("/auth/login")
      .set(csrf)
      .send({ email, password: PASSWORD });
    const cookie = login.headers["set-cookie"]![0]!.split(";")[0]!;
    const res = await request(t.app)
      .post("/open")
      .set({ ...csrf, Cookie: cookie });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect((await request(t.app).post("/open").set(csrf)).status).toBe(401);
  });

  it("answers a CORS preflight only for trusted origins (SEC-CORS-001)", async () => {
    const res = await request(app)
      .options("/auth/login")
      .set({ Origin: "https://evil.test", "Access-Control-Request-Method": "POST" });
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("serves notes only through guarded handlers", async () => {
    const t = await buildTestApp({
      config: playgroundConfig,
      mount: (router, auth) => {
        const notes = notesRoutes(auth);
        router.get("/api/notes", notes.list);
      },
    });
    expect((await request(t.app).get("/api/notes")).status).toBe(401);
  });
});

describe("clientAddress (SEC-RATE-005)", () => {
  const headers = (forwarded?: string) =>
    new Headers(forwarded ? { "x-forwarded-for": forwarded } : {});

  it("ignores X-Forwarded-For unless proxies are trusted", () => {
    expect(clientAddress(headers("203.0.113.9"), false, "127.0.0.1")).toBe("127.0.0.1");
    expect(clientAddress(headers("203.0.113.9"), false, null)).toBeNull();
  });

  it("counts proxies from the nearest one", () => {
    // client -> proxy 1 -> proxy 2 -> app: Next.js sees "client, proxy1".
    expect(clientAddress(headers("203.0.113.9"), 1, null)).toBe("203.0.113.9");
    expect(clientAddress(headers("198.51.100.1, 203.0.113.9"), 1, null)).toBe("203.0.113.9");
    expect(clientAddress(headers("198.51.100.1, 203.0.113.9"), 2, null)).toBe("198.51.100.1");
    // A client-supplied entry on the left never wins over what a proxy appended.
    expect(clientAddress(headers("10.0.0.1, 198.51.100.7"), 1, null)).toBe("198.51.100.7");
    // More proxies than entries: the left-most address.
    expect(clientAddress(headers("203.0.113.9"), 3, null)).toBe("203.0.113.9");
  });

  it("takes the socket into account when the platform has one", () => {
    expect(clientAddress(headers("203.0.113.9"), 1, "10.0.0.2")).toBe("203.0.113.9");
    expect(clientAddress(headers(), 1, "10.0.0.2")).toBe("10.0.0.2");
  });

  it("walks trusted CIDR ranges from the right", () => {
    const trusted = ["10.0.0.0/8", "fd00::/8"];
    expect(clientAddress(headers("203.0.113.9, 10.1.2.3"), trusted, null)).toBe("203.0.113.9");
    expect(clientAddress(headers("203.0.113.9, 198.51.100.4, 10.1.2.3"), trusted, null)).toBe(
      "198.51.100.4",
    );
    expect(clientAddress(headers("fd00::1"), trusted, null)).toBe("fd00::1");
  });

  it("never turns something that is not an address into a rate-limit key", () => {
    expect(clientAddress(headers("not-an-address"), 1, null)).toBeNull();
    expect(clientAddress(headers("x".repeat(500)), 1, null)).toBeNull();
    expect(clientAddress(headers(), 1, null)).toBeNull();
  });
});

describe("route files", () => {
  const ROOT = fileURLToPath(new URL("../src/app/", import.meta.url));
  const routeFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = `${dir}${name}`;
      return statSync(path).isDirectory()
        ? routeFiles(`${path}/`)
        : name === "route.ts"
          ? [path]
          : [];
    });

  it("serve every HTTP method SelfAuth answers, and refuse nothing silently", async () => {
    const auth = readFileSync(`${ROOT}auth/[[...path]]/route.ts`, "utf8");
    for (const verb of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(auth, verb).toMatch(new RegExp(`\\bas ${verb}\\b`));
    }
  });

  it("build every handler through SelfAuth (AUTHZ-CORE-002)", () => {
    // A route file under /api builds each handler with withAuth, which gives it the session, the
    // CSRF check, the guards and the error envelope. A handler exported as a plain function would
    // skip all of them.
    const files = routeFiles(`${ROOT}api/`);
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} defines a handler as a plain function`).not.toMatch(
        /export (?:async )?function (?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/,
      );
      const verbs = [
        ...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD) = ([^\n]*)/g),
      ];
      for (const [, verb, rest] of verbs) {
        expect(rest, `${file}: ${verb} is not built with withAuth`).toMatch(/withAuth\(/);
      }
      expect(source, file).toMatch(/\bwithAuth\(/);
    }
  });

  it("do not read the environment while the module loads (next build has none)", () => {
    for (const file of routeFiles(ROOT)) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/process\.env|loadEnv\(/);
    }
  });
});

describe("loadEnv (SEC-SECRET-003)", () => {
  it("requires SELFAUTH_APP_BASE_URL", () => {
    expect(() => loadEnv({ NODE_ENV: "development" })).toThrow(EnvError);
  });

  it("rejects invalid URLs and ports", () => {
    expect(() => loadEnv({ SELFAUTH_APP_BASE_URL: "not a url" })).toThrow(/not a valid URL/);
    expect(() => loadEnv({ SELFAUTH_APP_BASE_URL: "http://x.test", PORT: "70000" })).toThrow(
      /PORT/,
    );
  });

  it("requires https in production", () => {
    expect(() =>
      loadEnv({ NODE_ENV: "production", SELFAUTH_APP_BASE_URL: "http://app.example.test" }),
    ).toThrow(/https in production/);
    expect(
      loadEnv({ NODE_ENV: "production", SELFAUTH_APP_BASE_URL: "https://app.example.test" })
        .appBaseUrl.origin,
    ).toBe("https://app.example.test");
  });

  it("rejects CSRF secrets shorter than 32 bytes (SEC-SECRET-004)", () => {
    expect(() =>
      loadEnv({
        SELFAUTH_APP_BASE_URL: "http://x.test",
        SELFAUTH_CSRF_SECRET: Buffer.alloc(16).toString("base64url"),
      }),
    ).toThrow(/at least 32/);
    expect(
      loadEnv({
        SELFAUTH_APP_BASE_URL: "http://x.test",
        SELFAUTH_CSRF_SECRET: Buffer.alloc(32, 1).toString("base64url"),
      }).csrfSecret?.length,
    ).toBe(32);
  });
});

describe("startup", () => {
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("selfauth.instance")];
  });

  it("answers with the error envelope, not a stack trace, when the environment is invalid", async () => {
    const saved = process.env["SELFAUTH_APP_BASE_URL"];
    delete process.env["SELFAUTH_APP_BASE_URL"];
    try {
      const { GET } = await import("../src/app/auth/[[...path]]/route.ts");
      const res = await GET(new Request("https://app.example.test/auth/me"), {
        params: Promise.resolve({}),
      });
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text).error.code).toBe("INTERNAL_ERROR");
      expect(text).not.toMatch(/SELFAUTH_APP_BASE_URL|Invalid environment/);
    } finally {
      if (saved !== undefined) process.env["SELFAUTH_APP_BASE_URL"] = saved;
    }
  });

  it("stops a production server that cannot start, with a clear message (instrumentation.ts)", async () => {
    vi.stubEnv("SELFAUTH_APP_BASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { register } = await import("../src/instrumentation.ts");
      await expect(register()).rejects.toThrow("exit");
      expect(exit).toHaveBeenCalledWith(1);
      expect(log.mock.calls.flat().join(" ")).toContain("SelfAuth could not start");
      expect(log.mock.calls.flat().join(" ")).toContain("SELFAUTH_APP_BASE_URL");
    } finally {
      exit.mockRestore();
      log.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("serves the real route files from one shared instance", async () => {
    const t = await buildTestApp({ config: playgroundConfig });
    (globalThis as Record<symbol, unknown>)[Symbol.for("selfauth.instance")] = Promise.resolve({
      auth: t.auth,
      db: undefined,
    });
    const authRoute = await import("../src/app/auth/[[...path]]/route.ts");
    const notesRoute = await import("../src/app/api/notes/route.ts");
    const noteRoute = await import("../src/app/api/notes/[id]/route.ts");
    const catchAll = await import("../src/app/api/[[...path]]/route.ts");
    const call = (
      handler: (
        req: Request,
        ctx: { params: Promise<Record<string, string | string[] | undefined>> },
      ) => Promise<Response>,
      method: string,
      path: string,
      init: {
        headers?: Record<string, string>;
        body?: unknown;
        params?: Record<string, string>;
      } = {},
    ) =>
      handler(
        new Request(`https://app.example.test${path}`, {
          method,
          headers: { "Content-Type": "application/json", ...init.headers },
          ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        }),
        { params: Promise.resolve(init.params ?? {}) },
      );

    const email = "dave@example.test";
    expect(
      (
        await call(authRoute.POST, "POST", "/auth/register", {
          headers: csrf,
          body: { email, password: PASSWORD },
        })
      ).status,
    ).toBe(202);
    await call(authRoute.POST, "POST", "/auth/email/verify", {
      headers: csrf,
      body: { token: t.mailer.lastTo(email)!.token },
    });
    const login = await call(authRoute.POST, "POST", "/auth/login", {
      headers: csrf,
      body: { email, password: PASSWORD },
    });
    const cookie = login.headers.getSetCookie()[0]!.split(";")[0]!;

    expect((await call(notesRoute.GET, "GET", "/api/notes")).status).toBe(401);
    const created = await call(notesRoute.POST, "POST", "/api/notes", {
      headers: { ...csrf, Cookie: cookie },
      body: { text: "hi" },
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { note: { id: string } }).note.id;
    expect(
      (
        await call(noteRoute.GET, "GET", `/api/notes/${id}`, {
          headers: { Cookie: cookie },
          params: { id },
        })
      ).status,
    ).toBe(200);
    const missing = await call(catchAll.GET, "GET", "/api/anything");
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });
});

describe("policy registry", () => {
  it("replaces a policy registered again, so a route file can run twice in development", async () => {
    const { auth } = await buildTestApp({ config: playgroundConfig });
    const allow = {
      load: async () => ({ type: "x", id: "1", ownerId: "u" }),
      authorize: () => true,
    };
    const deny = { ...allow, authorize: () => false };
    const subject = { userId: "u", permissions: new Set(["x.view"]) } as never;
    auth.policies.register("x", allow);
    expect(await auth.policies.decide(subject, "x.view", "x", "1")).toBe("allow");
    auth.policies.register("x", deny);
    expect(await auth.policies.decide(subject, "x.view", "x", "1")).toBe("not_found");
  });

  it("decides like the core registry: deny without a policy, not_found without a resource", async () => {
    const { auth } = await buildTestApp({ config: playgroundConfig });
    const subject = { userId: "u", permissions: new Set(["x.view"]) } as never;
    const missing = { load: async () => null, authorize: () => true };
    const owned = {
      load: async () => ({ type: "x", id: "1", ownerId: "u" }),
      authorize: () => true,
    };
    expect(await auth.policies.decide(subject, "x.view", "none", "1")).toBe(
      await new PolicyRegistry().decide(subject, "x.view", "none", "1"),
    );
    for (const policy of [missing, owned]) {
      const core = new PolicyRegistry();
      auth.policies.register("x", policy);
      core.register("x", policy);
      expect(await auth.policies.decide(subject, "x.view", "x", "1")).toBe(
        await core.decide(subject, "x.view", "x", "1"),
      );
    }
  });
});
