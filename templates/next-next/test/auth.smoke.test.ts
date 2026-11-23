import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createAuth, MemoryAuthStore, MemoryMailer, syncRoles } from "../src/auth/index.ts";
import { localDevelopmentConfig } from "../src/config/dev-config.ts";
import { loadEnv } from "../src/config/env.ts";
import { config as baseConfig } from "../src/config/selfauth.config.ts";

/**
 * Smoke tests for the authentication wiring of THIS project, run with `npm test`. They call
 * your real route handlers (src/app/**\/route.ts) with your real configuration, an in-memory
 * store and a capturing mailer, so they need no database, no server and send no email. They are
 * yours: extend them with your own routes and rules. They check wiring, not the security
 * internals the SelfAuth conformance suite covers.
 */
const PASSWORD = "correct horse battery staple";
const EMAIL = "smoke@example.test";

// Plain-http local requests cannot use Secure / __Host- cookies, as in `npm run dev`.
const config = localDevelopmentConfig(baseConfig);
const env = loadEnv({ NODE_ENV: "test", SELFAUTH_APP_BASE_URL: "http://localhost:3000" });
const mailer = new MemoryMailer();

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string | string[] | undefined>> },
) => Promise<Response>;
// Each route module exports one handler per HTTP method (and Next.js settings such as `dynamic`).
const routes: Record<"auth" | "health" | "hello" | "api", Record<string, unknown>> = {
  auth: {},
  health: {},
  hello: {},
  api: {},
};

before(async () => {
  const store = new MemoryAuthStore();
  await syncRoles(store, config);
  const auth = createAuth({ config, store, mailer, appBaseUrl: env.appBaseUrl, nodeEnv: "test" });
  // The route handlers use whatever instance is registered here (src/lib/auth.ts).
  (globalThis as Record<symbol, unknown>)[Symbol.for("selfauth.instance")] = Promise.resolve({
    auth,
    db: undefined,
  });
  routes.auth = await import("../src/app/auth/[[...path]]/route.ts");
  routes.health = await import("../src/app/health/route.ts");
  routes.hello = await import("../src/app/api/hello/route.ts");
  routes.api = await import("../src/app/api/[[...path]]/route.ts");
});

interface Reply {
  status: number;
  body: { error?: { code?: string }; user?: { email?: string }; hello?: string } | null;
  cookies: string[];
}

async function call(
  route: keyof typeof routes,
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; csrf?: boolean } = {},
): Promise<Reply> {
  const handler = routes[route][method] as Handler | undefined;
  assert.ok(handler, `${route} does not export ${method}`);
  const response = await handler(
    new Request(`${env.appBaseUrl.origin}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        // What a same-origin browser sends; `csrf: false` leaves out the protection header.
        "Sec-Fetch-Site": "same-origin",
        Origin: env.appBaseUrl.origin,
        ...(options.csrf === false ? {} : { "X-SelfAuth-CSRF": "1" }),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }),
    { params: Promise.resolve({}) },
  );
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Reply["body"]) : null,
    cookies: response.headers.getSetCookie().map((c) => c.split(";")[0]!),
  };
}

describe("authentication wiring", () => {
  it("answers the health check", async () => {
    assert.equal((await call("health", "GET", "/health")).status, 200);
  });

  it("refuses an anonymous request for the current user", async () => {
    const reply = await call("auth", "GET", "/auth/me");
    assert.equal(reply.status, 401);
    assert.equal(reply.body?.error?.code, "UNAUTHENTICATED");
  });

  it("refuses a state-changing request without the CSRF header", async () => {
    const reply = await call("auth", "POST", "/auth/logout", { body: {}, csrf: false });
    assert.equal(reply.status, 403);
    assert.equal(reply.body?.error?.code, "CSRF_FAILED");
  });

  it("answers unknown routes with the error envelope", async () => {
    assert.equal((await call("auth", "GET", "/auth/no/such/route")).status, 404);
    assert.equal((await call("api", "GET", "/api/no/such/route")).status, 404);
  });

  it("rejects a weak password", async () => {
    const reply = await call("auth", "POST", "/auth/register", {
      body: { email: "weak@example.test", password: "short" },
    });
    assert.equal(reply.status, 400);
    assert.equal(reply.body?.error?.code, "PASSWORD_POLICY_VIOLATION");
  });

  it("protects your routes", async () => {
    const reply = await call("hello", "GET", "/api/hello");
    assert.equal(reply.status, 401);
  });

  it("registers, verifies, signs in, reads the session and signs out", async () => {
    const register = await call("auth", "POST", "/auth/register", {
      body: { email: EMAIL, password: PASSWORD },
    });
    assert.ok(register.status < 300, `register answered ${register.status}`);
    assert.deepEqual(register.cookies, [], "registration must not sign anyone in by itself");

    const verification = mailer.lastTo(EMAIL);
    assert.ok(verification?.token, "a verification email with a token was sent");
    const verify = await call("auth", "POST", "/auth/email/verify", {
      body: { token: verification.token },
    });
    assert.ok(verify.status < 300, `verify answered ${verify.status}`);

    const wrong = await call("auth", "POST", "/auth/login", {
      body: { email: EMAIL, password: "wrong" },
    });
    const unknown = await call("auth", "POST", "/auth/login", {
      body: { email: "nobody@example.test", password: "wrong" },
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body?.error?.code, unknown.body?.error?.code, "no account enumeration");

    const login = await call("auth", "POST", "/auth/login", {
      body: { email: EMAIL, password: PASSWORD },
    });
    assert.equal(login.status, 200);
    const cookie = login.cookies.join("; ");
    assert.ok(cookie, "login set a session cookie");

    const me = await call("auth", "GET", "/auth/me", { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.body?.user?.email, EMAIL);

    const hello = await call("hello", "GET", "/api/hello", { cookie });
    assert.equal(hello.status, 200);
    assert.equal(hello.body?.hello, EMAIL);

    const logout = await call("auth", "POST", "/auth/logout", { cookie, body: {} });
    assert.ok(logout.status < 300);
    assert.equal(
      (await call("auth", "GET", "/auth/me", { cookie })).status,
      401,
      "the session is revoked",
    );
  });
});
