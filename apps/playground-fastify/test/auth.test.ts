import {
  ERROR_HTTP_STATUS,
  parseConfig,
  SYSTEM_PERMISSIONS as SPEC_SYSTEM_PERMISSIONS,
} from "@selfauth/spec";
import { describe, expect, it, vi } from "vitest";
import { SYSTEM_PERMISSIONS } from "../src/auth/core/authorization.ts";
import { ManualClock } from "../src/auth/core/clock.ts";
import { hmacSha256 } from "../src/auth/core/crypto.ts";
import { normalizeEmail, validateEmail } from "../src/auth/core/email.ts";
import { AuthError } from "../src/auth/core/errors.ts";
import { redact } from "../src/auth/core/logger.ts";
import { checkPasswordPolicy, PasswordHasher } from "../src/auth/core/password.ts";
import { MemoryRateLimitStore, RateLimiter } from "../src/auth/core/rate-limit.ts";
import { HTTP_STATUS } from "../src/auth/fastify/index.ts";
import { createAuth, DevConsoleMailer, MemoryAuthStore, MemoryMailer } from "../src/auth/index.ts";
import { getRequestId } from "../src/http/request-id.ts";
import { localDevelopmentConfig } from "../src/config/dev-config.ts";
import { config as playgroundConfig } from "../src/config/selfauth.config.ts";
import { mountNotes } from "../src/routes/notes.ts";
import { buildTestApp, TEST_BASE_URL } from "./helpers.ts";
import { request } from "./http.ts";

const BASE = { adapter: { backend: "fastify", database: "postgresql", orm: "prisma" } } as const;
const PASSWORD = "correct horse battery staple";
const csrf = { "X-SelfAuth-CSRF": "1", "Sec-Fetch-Site": "same-origin" };

describe("runtime copies stay in sync with @selfauth/spec", () => {
  it("system permissions", () => {
    expect([...SYSTEM_PERMISSIONS]).toEqual([...SPEC_SYSTEM_PERMISSIONS]);
  });
  it("HTTP status mapping", () => {
    expect(HTTP_STATUS).toEqual(ERROR_HTTP_STATUS);
  });
  it("Fastify playground configuration is a valid, fully resolved spec configuration", () => {
    expect(parseConfig(playgroundConfig)).toEqual(playgroundConfig);
    expect(() => parseConfig(localDevelopmentConfig(playgroundConfig))).not.toThrow();
  });
});

describe("email", () => {
  it("normalizes and validates (IDENT-EMAIL-001/004)", () => {
    expect(normalizeEmail("  Alice@Example.TEST ")).toBe("alice@example.test");
    expect(validateEmail(" a@b.test ")).toBe("a@b.test");
    for (const bad of [
      "",
      "a",
      "@b",
      "a@",
      "a b@c.test",
      "a@b@c",
      "a\u0000@b.test",
      `${"x".repeat(250)}@b.test`,
      42,
    ]) {
      expect(validateEmail(bad)).toBeNull();
    }
  });
});

describe("password policy and hashing", () => {
  const cfg = parseConfig(BASE).authentication.password;

  it("enforces length, common passwords and email equality (SEC-PWPOLICY-*)", () => {
    expect(() => checkPasswordPolicy("short", cfg)).toThrow(AuthError);
    expect(() => checkPasswordPolicy("password1234", cfg)).toThrow(/policy/);
    expect(() =>
      checkPasswordPolicy("someone@example.test", cfg, "Someone@Example.test"),
    ).toThrow();
    expect(checkPasswordPolicy("  spaces count too  ", cfg)).toBe("  spaces count too  ");
  });

  it("produces Argon2id PHC strings and detects weaker parameters (SEC-HASH-003/004)", async () => {
    const weak = new PasswordHasher({ memoryKiB: 19456, iterations: 2, parallelism: 1 });
    const strong = new PasswordHasher({ memoryKiB: 47104, iterations: 2, parallelism: 1 });
    const hash = await weak.hash(PASSWORD);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await weak.verify(hash, PASSWORD)).toBe(true);
    expect(await weak.verify(hash, `${PASSWORD} `)).toBe(false);
    expect(await weak.verify("not-a-hash", PASSWORD)).toBe(false);
    expect(weak.needsRehash(hash)).toBe(false);
    expect(strong.needsRehash(hash)).toBe(true);
  });

  it("hashes on a worker thread without blocking other work (SEC-HASH-006)", async () => {
    const hasher = new PasswordHasher({ memoryKiB: 65536, iterations: 3, parallelism: 1 });
    let ticked = false;
    const tick = new Promise<void>((resolve) =>
      setImmediate(() => {
        ticked = true;
        resolve();
      }),
    );
    const hashing = hasher.hash(PASSWORD).then(() => ticked);
    await tick;
    expect(await hashing).toBe(true);
  });
});

describe("rate limiter (SEC-RATE-001/003)", () => {
  it("blocks at the limit, backs off exponentially, and recovers", async () => {
    const clock = new ManualClock();
    const limiter = new RateLimiter(new MemoryRateLimitStore(), clock);
    const rule = { limit: 2, windowSeconds: 60 };
    expect((await limiter.hit("k", rule)).allowed).toBe(true);
    const second = await limiter.hit("k", rule);
    expect(second).toMatchObject({ allowed: true, justBlocked: true });
    expect(await limiter.hit("k", rule)).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
    clock.advance(61_000);
    await limiter.hit("k", rule);
    expect((await limiter.hit("k", rule)).justBlocked).toBe(true);
    expect((await limiter.check("k", rule)).retryAfterSeconds).toBe(120); // second strike doubles
    clock.advance(121_000);
    expect((await limiter.check("k", rule)).allowed).toBe(true);
    await limiter.reset("k");
    expect((await limiter.check("k", rule)).allowed).toBe(true);
  });
});

describe("log redaction (SEC-LOG-001)", () => {
  it("redacts sensitive keys and token-like values", () => {
    const out = JSON.stringify(
      redact({
        password: PASSWORD,
        headers: { Cookie: "a=b", Authorization: "Bearer x" },
        nested: [{ newPassword: "x" }],
        note: `token ${"A".repeat(43)} here`,
      }),
    );
    expect(out).not.toContain(PASSWORD);
    expect(out).not.toContain("a=b");
    expect(out).not.toContain("Bearer");
    expect(out).not.toContain("A".repeat(43));
  });

  it("keeps UUIDs such as request IDs so logs can be correlated (SEC-LOG-003)", () => {
    const id = "39199157-689f-4896-94c8-093eeb0e10f0";
    expect(redact({ requestId: id, note: `req ${id}` })).toEqual({
      requestId: id,
      note: `req ${id}`,
    });
    // A 64-char hex hash or 43-char base64url token is still removed.
    expect(redact("a".repeat(64))).toBe("[redacted]");
  });
});

describe("startup safety", () => {
  const options = (overrides: Record<string, unknown>) => ({
    config: parseConfig(BASE),
    store: new MemoryAuthStore(),
    mailer: new MemoryMailer(),
    appBaseUrl: new URL(TEST_BASE_URL),
    nodeEnv: "production" as const,
    requestId: getRequestId,
    ...overrides,
  });

  it("refuses insecure cookies in production (SEC-COOKIE-003)", () => {
    const config = parseConfig({
      ...BASE,
      authentication: { sessions: { cookie: { name: "dev", secure: false } } },
    });
    expect(() => createAuth(options({ config }))).toThrow(/secure must be true/);
    expect(() => createAuth(options({ config, nodeEnv: "development" }))).not.toThrow();
  });

  it("refuses configuration the adapter cannot honour (CONF-FILE-004)", () => {
    // Every database the schema names is implemented now, so the refusal is shown with a name the
    // schema does not know: a database added to the schema before an adapter supports it.
    const config = parseConfig({
      ...BASE,
      adapter: { backend: "fastify", database: "postgresql", orm: "prisma" },
    });
    const unsupported = { ...config, adapter: { ...config.adapter, database: "cockroachdb" } };
    expect(() => createAuth(options({ config: unsupported as never }))).toThrow(
      /does not support database 'cockroachdb'/,
    );
  });

  it("refuses token-mode CSRF without a strong secret (SEC-SECRET-003)", () => {
    const config = parseConfig({ ...BASE, http: { csrf: { mode: "token" } } });
    expect(() => createAuth(options({ config }))).toThrow(/CSRF secret/);
    expect(() => createAuth(options({ config, csrfSecret: Buffer.alloc(16) }))).toThrow(
      /CSRF secret/,
    );
  });

  it("refuses the console mailer in production", () => {
    expect(() => new DevConsoleMailer("production")).toThrow();
  });

  it("rejects guards for undefined permissions at definition time (AUTHZ-PERM-004)", () => {
    const auth = createAuth(options({}));
    expect(() => auth.requirePermission("orders.view")).toThrow(/Unknown permission/);
    expect(() => auth.requirePermission("auth.users.read")).not.toThrow();
  });
});

describe("timing protections", () => {
  it("verifies against a dummy hash for unknown users (AUTHN-LOGIN-003)", async () => {
    const t = await buildTestApp();
    const dummy = vi.spyOn(t.auth.hasher, "verifyDummy");
    const res = await request(t.app)
      .post("/auth/login")
      .set(csrf)
      .send({ email: "nobody@example.test", password: PASSWORD });
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(dummy).toHaveBeenCalledOnce();
  });

  it("hashes the password when registering an existing email (AUTHN-REG-010)", async () => {
    const t = await buildTestApp();
    await request(t.app)
      .post("/auth/register")
      .set(csrf)
      .send({ email: "a@example.test", password: PASSWORD });
    const hash = vi.spyOn(t.auth.hasher, "hash");
    const res = await request(t.app)
      .post("/auth/register")
      .set(csrf)
      .send({ email: "a@example.test", password: PASSWORD });
    expect(res.status).toBe(202);
    expect(hash).toHaveBeenCalledOnce();
  });
});

describe("registration is atomic (AUTHN-REG-003)", () => {
  it("creates no user when the credential/roles cannot be written", async () => {
    const t = await buildTestApp();
    await t.store.syncRoles(new Map()); // default role missing → createUser fails before writing
    const res = await request(t.app)
      .post("/auth/register")
      .set(csrf)
      .send({ email: "b@example.test", password: PASSWORD });
    expect(res.status).toBe(500);
    expect(t.memory!.inspect("user")).toHaveLength(0);
    expect(t.memory!.inspect("credential")).toHaveLength(0);
  });
});

describe("re-hashing on login (SEC-HASH-004)", () => {
  it("upgrades a hash created with weaker parameters", async () => {
    const config = parseConfig({
      ...BASE,
      authentication: { password: { hashing: { memoryKiB: 47104, iterations: 2 } } },
    });
    const t = await buildTestApp({ config });
    const weakHash = await new PasswordHasher({
      memoryKiB: 19456,
      iterations: 2,
      parallelism: 1,
    }).hash(PASSWORD);
    const now = t.clock.now();
    const user = await t.store.createUser({
      user: {
        id: crypto.randomUUID(),
        email: "c@example.test",
        emailNormalized: "c@example.test",
        emailVerifiedAt: now,
        state: "active",
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      passwordHash: weakHash,
      roles: ["user"],
    });
    const res = await request(t.app)
      .post("/auth/login")
      .set(csrf)
      .send({ email: "c@example.test", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await t.store.getPasswordHash(user.id)).toMatch(/\$m=47104,t=2,p=1\$/);
  });
});

describe("CSRF secret rotation (SEC-SECRET-004)", () => {
  it("accepts tokens signed with the previous secret", async () => {
    const previous = Buffer.alloc(32, 9);
    const config = parseConfig({ ...BASE, http: { csrf: { mode: "token" } } });
    const t = await buildTestApp({ config });
    const auth = createAuth({
      config,
      store: t.store,
      mailer: t.mailer,
      clock: t.clock,
      appBaseUrl: new URL(TEST_BASE_URL),
      nodeEnv: "test",
      requestId: getRequestId,
      csrfSecret: Buffer.alloc(32, 8),
      csrfSecretPrevious: previous,
    });
    const { createApp } = await import("../src/app.ts");
    const app = createApp({ env: t.env, config, auth });
    await request(app)
      .post("/auth/register")
      .set({ "Sec-Fetch-Site": "same-origin" })
      .send({ email: "d@example.test", password: PASSWORD });
    const token = t.mailer.lastTo("d@example.test")!.token!;
    await request(app)
      .post("/auth/email/verify")
      .set({ "Sec-Fetch-Site": "same-origin" })
      .send({ token });
    const login = await request(app)
      .post("/auth/login")
      .set({ "Sec-Fetch-Site": "same-origin" })
      .send({ email: "d@example.test", password: PASSWORD });
    const cookie = login.headers["set-cookie"]![0]!.split(";")[0]!;
    const sessionId = (await request(app).get("/auth/me").set("Cookie", cookie)).body.session
      .id as string;
    const oldToken = hmacSha256(previous, `csrf:${sessionId}`);
    const res = await request(app)
      .post("/auth/logout-all")
      .set({ Cookie: cookie, "X-SelfAuth-CSRF": oldToken, "Sec-Fetch-Site": "same-origin" });
    expect(res.status).toBe(204);
  });
});

describe("example notes module", () => {
  it("enforces permissions and ownership end to end", async () => {
    const t = await buildTestApp({ config: playgroundConfig, mount: mountNotes });
    const signIn = async (email: string) => {
      await request(t.app).post("/auth/register").set(csrf).send({ email, password: PASSWORD });
      await request(t.app)
        .post("/auth/email/verify")
        .set(csrf)
        .send({ token: t.mailer.lastTo(email)!.token });
      const res = await request(t.app)
        .post("/auth/login")
        .set(csrf)
        .send({ email, password: PASSWORD });
      return res.headers["set-cookie"]![0]!.split(";")[0]!;
    };
    const alice = await signIn("alice@example.test");
    const bob = await signIn("bob@example.test");

    const created = await request(t.app)
      .post("/api/notes")
      .set({ ...csrf, Cookie: alice })
      .send({ text: "hi" });
    expect(created.status).toBe(201);
    const id = created.body.note.id as string;

    expect((await request(t.app).get(`/api/notes/${id}`).set("Cookie", alice)).status).toBe(200);
    expect((await request(t.app).get(`/api/notes/${id}`).set("Cookie", bob)).status).toBe(404);
    expect((await request(t.app).get("/api/notes").set("Cookie", bob)).body.notes).toEqual([]);
    expect((await request(t.app).get(`/api/notes/${id}`)).status).toBe(401);
  });
});
