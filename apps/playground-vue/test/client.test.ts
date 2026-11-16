import { describe, expect, it, vi } from "vitest";
import { AuthApiError, createAuthClient, describeError } from "../src/auth/index.ts";

type Call = { url: string; init: RequestInit };

function mockFetch(
  responses: { status: number; body?: unknown; headers?: Record<string, string> }[],
) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 204 };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: r.headers ?? {},
    });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const user = {
  id: "u1",
  email: "a@x.test",
  emailVerified: true,
  state: "active",
  roles: ["user"],
  permissions: ["notes.view"],
};

describe("createAuthClient", () => {
  it("sends cookies, JSON and the CSRF header on every request (SEC-CSRF-004)", async () => {
    const m = mockFetch([{ status: 200, body: { user } }]);
    const client = createAuthClient({ fetch: m.fetch });
    await client.login({ email: "a@x.test", password: "pw" });
    const { url, init } = m.calls[0]!;
    expect(url).toBe("/auth/login");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-SelfAuth-CSRF": "1",
    });
    expect(JSON.parse(String(init.body))).toEqual({ email: "a@x.test", password: "pw" });
  });

  it("respects a custom base URL, base path and header name", async () => {
    const m = mockFetch([{ status: 204 }]);
    const client = createAuthClient({
      fetch: m.fetch,
      baseUrl: "https://api.example.test",
      basePath: "/v1/auth",
      csrf: { mode: "header", headerName: "X-CSRF" },
    });
    await client.logout();
    expect(m.calls[0]!.url).toBe("https://api.example.test/v1/auth/logout");
    expect(m.calls[0]!.init.headers).toMatchObject({ "X-CSRF": "1" });
  });

  it("keeps the token-mode CSRF token in memory and sends it back", async () => {
    const m = mockFetch([
      { status: 200, body: { user, csrfToken: "csrf-abc" } },
      { status: 204 },
      { status: 204 },
    ]);
    const client = createAuthClient({ fetch: m.fetch, csrf: { mode: "token" } });
    await client.login({ email: "a@x.test", password: "pw" });
    await client.logoutAll();
    await client.logout();
    expect(m.calls[1]!.init.headers).toMatchObject({ "X-SelfAuth-CSRF": "csrf-abc" });
    expect(m.calls[2]!.init.headers).toMatchObject({ "X-SelfAuth-CSRF": "" }); // forgotten after logout
  });

  it("raises AuthApiError with the spec code, details and Retry-After", async () => {
    const m = mockFetch([
      {
        status: 429,
        body: { error: { code: "RATE_LIMITED", message: "slow down" } },
        headers: { "Retry-After": "30" },
      },
    ]);
    const client = createAuthClient({ fetch: m.fetch });
    const error = await client
      .login({ email: "a@x.test", password: "pw" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthApiError);
    expect(error).toMatchObject({ code: "RATE_LIMITED", status: 429, retryAfterSeconds: 30 });
  });

  it("maps network failures and non-JSON responses to client codes", async () => {
    const offline = createAuthClient({
      fetch: (async () => {
        throw new TypeError("offline");
      }) as unknown as typeof fetch,
    });
    await expect(offline.logout()).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    const html = createAuthClient({
      fetch: (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch,
    });
    await expect(html.logout()).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE" });
  });

  it("returns null from me() when signed out, without firing onUnauthenticated", async () => {
    const onUnauthenticated = vi.fn();
    const m = mockFetch([
      { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "x" } } },
    ]);
    expect(await createAuthClient({ fetch: m.fetch, onUnauthenticated }).me()).toBeNull();
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it("fires onUnauthenticated when an authenticated call finds the session gone", async () => {
    const onUnauthenticated = vi.fn();
    const m = mockFetch([
      { status: 401, body: { error: { code: "UNAUTHENTICATED", message: "x" } } },
    ]);
    await expect(
      createAuthClient({ fetch: m.fetch, onUnauthenticated }).api("GET", "/api/notes"),
    ).rejects.toThrow();
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it("distinguishes registration that signs in from the private default", async () => {
    const m = mockFetch([
      { status: 202, body: { status: "accepted" } },
      { status: 201, body: { user } },
    ]);
    const client = createAuthClient({ fetch: m.fetch });
    expect(await client.register({ email: "a@x.test", password: "pw" })).toEqual({
      signedIn: false,
    });
    expect(await client.register({ email: "b@x.test", password: "pw" })).toEqual({
      signedIn: true,
      user,
    });
  });
});

describe("describeError", () => {
  it("maps codes to generic messages, never echoing server text", () => {
    expect(
      describeError(new AuthApiError("INVALID_CREDENTIALS", "server said user not found", 401)),
    ).toBe("Email or password is incorrect.");
    expect(
      describeError(
        new AuthApiError("PASSWORD_POLICY_VIOLATION", "", 400, [
          { field: "password", issue: "min_length_12" },
        ]),
      ),
    ).toBe("Use at least 12 characters.");
    expect(
      describeError(
        new AuthApiError("PASSWORD_POLICY_VIOLATION", "", 400, [
          { field: "password", issue: "too_common" },
        ]),
      ),
    ).toMatch(/too common/);
    expect(describeError(new Error("boom"))).toBe("Something went wrong. Please try again.");
  });
});
