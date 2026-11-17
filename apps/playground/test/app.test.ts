import request from "supertest";
import { describe, expect, it } from "vitest";
import { EnvError, loadEnv } from "../src/env.ts";
import { buildTestApp } from "./helpers.ts";

describe("playground app", async () => {
  const { app } = await buildTestApp();

  it("responds to /health", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not advertise the framework", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("returns the spec error envelope for unknown routes", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: "Not found.", requestId: res.headers["x-request-id"] },
    });
  });

  it("rejects bodies over the configured limit with PAYLOAD_TOO_LARGE (SEC-HTTP-003)", async () => {
    const res = await request(app)
      .post("/health")
      .set("Content-Type", "application/json")
      .set("X-SelfAuth-CSRF", "1")
      .send(JSON.stringify({ data: "x".repeat(17 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects malformed JSON without echoing parser internals", async () => {
    const res = await request(app)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .set("X-SelfAuth-CSRF", "1")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|Unexpected token|at /);
  });

  it("hides internals of unexpected errors and redacts the server log (SEC-LOG-002)", async () => {
    const t = await buildTestApp({
      mount: (a) =>
        a.get("/boom", () => {
          throw new Error(
            "SELECT * FROM secrets WHERE token='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'",
          );
        }),
    });
    const res = await request(t.app).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|Error:/);
    expect(t.logs.lines.join("\n")).toContain("unhandled error");
    expect(t.logs.lines.join("\n")).not.toContain("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
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

describe("route guards (AUTHZ-CORE-002)", () => {
  // A small lint: every route the generated application registers names a guard from `auth`
  // in its first lines, or sits on `auth.protectedRoutes()`, which denies anything unguarded.
  const files = [
    "src/example/notes.ts",
    "src/routes.ts",
    "../../packages/cli/template-variants/routes.ts",
  ];
  const ROUTE = /\b\w+\.(?:get|post|put|patch|delete|all)\(\s*["'`][^"'`]*["'`]/g;
  const GUARD = /auth\.(requireAuth|requirePermission|authorizeResource)\b/;

  it("declares a guard on every route", async () => {
    const { readFile } = await import("node:fs/promises");
    let routes = 0;
    for (const file of files) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
      const usesProtected = /auth\.protectedRoutes\(\)/.test(source);
      for (const m of source.matchAll(ROUTE)) {
        routes++;
        const head = source.slice(m.index, m.index + 220);
        expect(GUARD.test(head) || usesProtected, `${file}: unguarded route ${m[0]}`).toBe(true);
      }
    }
    expect(routes).toBeGreaterThanOrEqual(4);
  });

  it("would catch an unguarded route", () => {
    const bad = 'api.get("/x", (_req, res) => { res.json({}); });';
    expect(GUARD.test(bad.slice(0, 220))).toBe(false);
  });
});
