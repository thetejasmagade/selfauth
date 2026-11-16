import { describe, expect, it } from "vitest";
import { configJsonSchema, parseConfig, readSpecFile, SYSTEM_PERMISSIONS } from "../src/index.js";

const minimal = {
  adapter: { backend: "express", database: "postgresql", orm: "prisma" },
} as const;

function issues(input: unknown): string[] {
  try {
    parseConfig(input);
    return [];
  } catch (error) {
    const zodIssues = (error as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
    if (!zodIssues) throw error;
    return zodIssues.map((i) => `${i.path.join(".")}: ${i.message}`);
  }
}

function withAuth(authentication: Record<string, unknown>) {
  return { ...minimal, authentication };
}

describe("selfAuthConfigSchema defaults", () => {
  const config = parseConfig(minimal);

  it("applies secure defaults from CONFIGURATION_SPEC", () => {
    expect(config.specVersion).toBe("0.1");
    expect(config.adapter.frontend).toBe("none");
    expect(config.authentication.emailVerification).toEqual({
      mode: "required",
      tokenTtlMinutes: 1440,
    });
    expect(config.authentication.passwordReset.tokenTtlMinutes).toBe(30);
    expect(config.authentication.registration).toEqual({
      revealExistingEmail: false,
      signInAfterRegistration: false,
    });
    expect(config.authentication.password).toEqual({
      minLength: 12,
      maxLength: 128,
      rejectCommon: true,
      hashing: { memoryKiB: 19_456, iterations: 2, parallelism: 1 },
    });
    expect(config.authentication.sessions).toMatchObject({
      strategy: "database",
      idleTimeoutMinutes: 10_080,
      absoluteTimeoutMinutes: 43_200,
      touchIntervalSeconds: 60,
      cookie: { name: "__Host-session", sameSite: "lax", secure: true },
    });
    expect(config.authentication.rateLimit.login).toEqual({
      perAccount: { limit: 5, windowSeconds: 900 },
      perAddress: { limit: 100, windowSeconds: 900 },
    });
    expect(config.authorization).toEqual({
      strategy: "rbac",
      permissions: [],
      roles: { user: [] },
      defaultRoles: ["user"],
      reauthenticationWindowMinutes: 15,
    });
    expect(config.http).toEqual({
      bodyLimitBytes: 16_384,
      basePath: "/auth",
      trustedOrigins: [],
      trustProxy: false,
      csrf: { mode: "header", headerName: "X-SelfAuth-CSRF" },
    });
  });

  it("accepts the documented example", () => {
    expect(
      issues({
        adapter: { frontend: "vue", backend: "express", database: "postgresql", orm: "prisma" },
        authentication: {
          emailVerification: { mode: "required" },
          sessions: { idleTimeoutMinutes: 1440 },
        },
        authorization: {
          permissions: ["users.manage", "orders.create", "orders.view", "orders.view_any"],
          roles: {
            user: ["orders.create", "orders.view"],
            support: ["orders.view_any"],
            admin: ["users.manage", ...SYSTEM_PERMISSIONS],
          },
        },
        http: { trustedOrigins: ["https://app.example.com"] },
      }),
    ).toEqual([]);
  });
});

describe("selfAuthConfigSchema rejections", () => {
  it.each([
    ["unknown keys (CONF-FILE-001)", { ...minimal, authentcation: {} }],
    ["unknown nested keys", withAuth({ password: { minLen: 10 } })],
    ["password minLength below 8 (SEC-PWPOLICY-001)", withAuth({ password: { minLength: 7 } })],
    ["password maxLength below 64 (SEC-PWPOLICY-002)", withAuth({ password: { maxLength: 63 } })],
    ["minLength above maxLength", withAuth({ password: { minLength: 100, maxLength: 64 } })],
    [
      "reset TTL above 60 minutes (AUTHN-RESET-003)",
      withAuth({ passwordReset: { tokenTtlMinutes: 61 } }),
    ],
    [
      "verification TTL above 7 days (AUTHN-VERIFY-004)",
      withAuth({ emailVerification: { tokenTtlMinutes: 10_081 } }),
    ],
    [
      "idle timeout above absolute timeout (AUTHN-SESS-004)",
      withAuth({ sessions: { idleTimeoutMinutes: 100, absoluteTimeoutMinutes: 50 } }),
    ],
    [
      "__Host- cookie without secure (SEC-COOKIE-002)",
      withAuth({ sessions: { cookie: { secure: false } } }),
    ],
    [
      "sameSite none with header CSRF (SEC-COOKIE-005)",
      withAuth({ sessions: { cookie: { sameSite: "none" } } }),
    ],
    ["non-integer values", withAuth({ password: { minLength: 12.5 } })],
    [
      "mismatched ORM",
      { adapter: { backend: "express", database: "postgresql", orm: "mongoose" } },
    ],
    ["unsupported major specVersion (CONF-FILE-005)", { ...minimal, specVersion: "1.0" }],
    [
      "reserved auth. permission prefix (AUTHZ-PERM-002)",
      { ...minimal, authorization: { permissions: ["auth.foo"] } },
    ],
    [
      "malformed permission (AUTHZ-PERM-001)",
      { ...minimal, authorization: { permissions: ["orders"] } },
    ],
    [
      "wildcard permission (AUTHZ-PERM-003)",
      { ...minimal, authorization: { permissions: ["orders.*"] } },
    ],
    ["duplicate permission", { ...minimal, authorization: { permissions: ["a.b", "a.b"] } }],
    [
      "role with undefined permission (AUTHZ-PERM-004)",
      { ...minimal, authorization: { roles: { user: ["orders.view"] } } },
    ],
    [
      "admin as default role (AUTHZ-ADMIN-005)",
      { ...minimal, authorization: { roles: { user: [], admin: [] }, defaultRoles: ["admin"] } },
    ],
    ["undefined default role", { ...minimal, authorization: { defaultRoles: ["member"] } }],
    ["origin with path", { ...minimal, http: { trustedOrigins: ["https://app.example.com/"] } }],
    ["non-http origin", { ...minimal, http: { trustedOrigins: ["ftp://example.com"] } }],
    ["missing adapter", {}],
    [
      "Argon2id memory below 19 MiB (SEC-HASH-002)",
      withAuth({ password: { hashing: { memoryKiB: 19_455 } } }),
    ],
    [
      "Argon2id single iteration with less than 46 MiB (SEC-HASH-002)",
      withAuth({ password: { hashing: { iterations: 1 } } }),
    ],
    [
      "signInAfterRegistration without revealExistingEmail (AUTHN-REG-012)",
      withAuth({
        emailVerification: { mode: "optional" },
        registration: { signInAfterRegistration: true },
      }),
    ],
    [
      "signInAfterRegistration in required verification mode (AUTHN-REG-012)",
      withAuth({ registration: { revealExistingEmail: true, signInAfterRegistration: true } }),
    ],
    ["body limit below 1 KiB", { ...minimal, http: { bodyLimitBytes: 512 } }],
    ["re-auth window of zero", { ...minimal, authorization: { reauthenticationWindowMinutes: 0 } }],
  ])("rejects %s", (_name, input) => {
    expect(issues(input)).not.toEqual([]);
  });

  it("allows insecure cookies only under a non-__Host- name (local development)", () => {
    expect(
      issues(withAuth({ sessions: { cookie: { name: "dev_session", secure: false } } })),
    ).toEqual([]);
  });

  it("allows the opt-in convenient registration flow (SEC-ENUM-004)", () => {
    expect(
      issues(
        withAuth({
          emailVerification: { mode: "optional" },
          registration: { revealExistingEmail: true, signInAfterRegistration: true },
        }),
      ),
    ).toEqual([]);
    expect(issues(withAuth({ registration: { revealExistingEmail: true } }))).toEqual([]);
  });

  it("allows sameSite none with token CSRF", () => {
    expect(
      issues({
        ...withAuth({ sessions: { cookie: { sameSite: "none" } } }),
        http: { csrf: { mode: "token" } },
      }),
    ).toEqual([]);
  });
});

describe("defaults are configurable within bounds", () => {
  it("accepts stronger and alternative secure settings", () => {
    expect(
      issues({
        ...minimal,
        authentication: {
          emailVerification: { mode: "optional", tokenTtlMinutes: 60 },
          passwordReset: { tokenTtlMinutes: 15 },
          password: { minLength: 15, hashing: { memoryKiB: 47_104, iterations: 1 } },
          sessions: {
            idleTimeoutMinutes: 30,
            absoluteTimeoutMinutes: 480,
            touchIntervalSeconds: 0,
          },
          rateLimit: { login: { perAccount: { limit: 3, windowSeconds: 3_600 } } },
        },
        authorization: { reauthenticationWindowMinutes: 5 },
        http: { bodyLimitBytes: 8_192 },
      }),
    ).toEqual([]);
  });
});

describe("CONFIGURATION_SPEC.md", () => {
  it("documents the same defaults the schema applies", async () => {
    const md = await readSpecFile("CONFIGURATION_SPEC.md");
    const resolved = parseConfig(minimal) as unknown as Record<string, unknown>;
    const rows = [...md.matchAll(/^\| `([a-zA-Z.]+)` \| (?:[^|\\]|\\.)+ \| `([^`]+)`/gm)];
    expect(rows.length).toBeGreaterThanOrEqual(30);
    const mismatches: string[] = [];
    for (const [, key, documented] of rows) {
      let value: unknown = resolved;
      for (const part of key!.split(".")) value = (value as Record<string, unknown>)[part];
      // Documented defaults are JSON, except object keys may be unquoted ({ user: [] }).
      const normalized = documented!.replace(/([{,]\s*)(\w+):/g, '$1"$2":');
      if (JSON.stringify(JSON.parse(normalized)) !== JSON.stringify(value)) {
        mismatches.push(`${key}: documented ${documented}, schema ${JSON.stringify(value)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("configJsonSchema", () => {
  it("exports a JSON Schema for non-TypeScript adapters", () => {
    const schema = configJsonSchema();
    expect(schema.type).toBe("object");
    expect(schema).toHaveProperty("properties.adapter");
    expect(schema.additionalProperties).toBe(false);
  });
});
