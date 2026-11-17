import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.ts";
import { createAuth, MemoryAuthStore, MemoryMailer, syncRoles } from "../src/auth/index.ts";
import { localDevelopmentConfig } from "../src/dev-config.ts";
import { loadEnv } from "../src/env.ts";
import { getRequestId } from "../src/request-id.ts";
import { mountRoutes } from "../src/routes.ts";
import { config as baseConfig } from "../src/selfauth.config.ts";

/**
 * Smoke tests for the authentication wiring of THIS project, run with `npm test`. They use
 * your real configuration, routes and app, an in-memory store and a capturing mailer, so they
 * need no database and send no email. They are yours: extend them with your own routes and
 * rules. They check wiring, not the security internals the SelfAuth conformance suite covers.
 */
const PASSWORD = "correct horse battery staple";
const EMAIL = "smoke@example.test";

// Plain-http local requests cannot use Secure / __Host- cookies, as in `npm run dev`.
const config = localDevelopmentConfig(baseConfig);
const env = loadEnv({ NODE_ENV: "test", SELFAUTH_APP_BASE_URL: "http://localhost:5173" });

let baseUrl = "";
let close: () => Promise<void>;
const mailer = new MemoryMailer();

before(async () => {
  const store = new MemoryAuthStore();
  await syncRoles(store, config);
  const auth = createAuth({
    config,
    store,
    mailer,
    appBaseUrl: env.appBaseUrl,
    nodeEnv: "test",
    requestId: getRequestId,
  });
  const server = createApp({ env, config, auth, mount: mountRoutes }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise((resolve) => server.close(() => resolve()));
});
after(() => close());

interface Reply {
  status: number;
  body: { error?: { code?: string }; user?: { email?: string } } | null;
  cookies: string[];
}

async function call(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; csrf?: boolean } = {},
): Promise<Reply> {
  const response = await fetch(`${baseUrl}${path}`, {
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
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as Reply["body"]) : null,
    cookies: response.headers.getSetCookie().map((c) => c.split(";")[0]!),
  };
}

describe("authentication wiring", () => {
  it("answers the health check", async () => {
    assert.equal((await call("GET", "/health")).status, 200);
  });

  it("refuses an anonymous request for the current user", async () => {
    const reply = await call("GET", "/auth/me");
    assert.equal(reply.status, 401);
    assert.equal(reply.body?.error?.code, "UNAUTHENTICATED");
  });

  it("refuses a state-changing request without the CSRF header", async () => {
    const reply = await call("POST", "/auth/logout", { body: {}, csrf: false });
    assert.equal(reply.status, 403);
    assert.equal(reply.body?.error?.code, "CSRF_FAILED");
  });

  it("denies unknown routes by default", async () => {
    assert.equal((await call("GET", "/no/such/route")).status, 404);
  });

  it("rejects a weak password", async () => {
    const reply = await call("POST", "/auth/register", {
      body: { email: "weak@example.test", password: "short" },
    });
    assert.equal(reply.status, 400);
    assert.equal(reply.body?.error?.code, "PASSWORD_POLICY_VIOLATION");
  });

  it("registers, verifies, signs in, reads the session and signs out", async () => {
    const register = await call("POST", "/auth/register", {
      body: { email: EMAIL, password: PASSWORD },
    });
    assert.ok(register.status < 300, `register answered ${register.status}`);
    assert.deepEqual(register.cookies, [], "registration must not sign anyone in by itself");

    const verification = mailer.lastTo(EMAIL);
    assert.ok(verification?.token, "a verification email with a token was sent");
    const verify = await call("POST", "/auth/email/verify", {
      body: { token: verification.token },
    });
    assert.ok(verify.status < 300, `verify answered ${verify.status}`);

    const wrong = await call("POST", "/auth/login", { body: { email: EMAIL, password: "wrong" } });
    const unknown = await call("POST", "/auth/login", {
      body: { email: "nobody@example.test", password: "wrong" },
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body?.error?.code, unknown.body?.error?.code, "no account enumeration");

    const login = await call("POST", "/auth/login", { body: { email: EMAIL, password: PASSWORD } });
    assert.equal(login.status, 200);
    const cookie = login.cookies.join("; ");
    assert.ok(cookie, "login set a session cookie");

    const me = await call("GET", "/auth/me", { cookie });
    assert.equal(me.status, 200);
    assert.equal(me.body?.user?.email, EMAIL);

    const logout = await call("POST", "/auth/logout", { cookie, body: {} });
    assert.ok(logout.status < 300);
    assert.equal((await call("GET", "/auth/me", { cookie })).status, 401, "the session is revoked");
  });
});
