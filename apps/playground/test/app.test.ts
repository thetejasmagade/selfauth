import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { EnvError, loadEnv } from "../src/env.ts";

const env = loadEnv({ NODE_ENV: "test", SELFAUTH_APP_BASE_URL: "http://localhost:5173" });

describe("playground app", () => {
  const app = createApp(env);

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

  it("rejects bodies over 16 KiB with PAYLOAD_TOO_LARGE (SEC-HTTP-003)", async () => {
    const res = await request(app)
      .post("/health")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ data: "x".repeat(17 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rejects malformed JSON without echoing parser internals", async () => {
    const res = await request(app)
      .post("/health")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|Unexpected token|at /);
  });

  it("hides internals of unexpected errors (SEC-LOG-002)", async () => {
    const faulty = createApp(env, {
      mount: (a) =>
        a.get("/boom", () => {
          throw new Error("SELECT * FROM secrets failed at db.ts:12:3");
        }),
    });
    const res = await request(faulty).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|db\.ts|Error:/);
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
});
