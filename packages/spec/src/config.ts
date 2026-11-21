/**
 * Machine-readable form of specs/CONFIGURATION_SPEC.md.
 * Unknown keys are rejected (CONF-FILE-001); out-of-range values are rejected,
 * never clamped (CONF-FILE-003).
 */
import { z } from "zod";

export const SPEC_VERSION = "0.1";

/** AUTHZ-PERM-001: two or more dot-separated `[a-z][a-z0-9_]*` segments. */
export const PERMISSION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
/** AUTHZ-RBAC-001. */
export const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

/** System permissions held by the `admin` role (AUTHORIZATION_SPEC §5). */
export const SYSTEM_PERMISSIONS = [
  "auth.users.read",
  "auth.users.manage",
  "auth.sessions.manage",
  "auth.roles.assign",
  "auth.roles.manage",
  "auth.audit.read",
] as const;

export const SYSTEM_ROLES = ["admin", "user"] as const;

const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** Minimum Argon2id profiles (SEC-HASH-002, OWASP). A configuration must meet at least one. */
export const ARGON2_FLOORS = [
  { memoryKiB: 19_456, iterations: 2 },
  { memoryKiB: 47_104, iterations: 1 },
] as const;

export function meetsArgon2Floor(p: { memoryKiB: number; iterations: number }): boolean {
  return ARGON2_FLOORS.some((f) => p.memoryKiB >= f.memoryKiB && p.iterations >= f.iterations);
}

const limitSchema = (limit: number) =>
  z
    .strictObject({
      limit: int(1, 1_000_000).default(limit),
      windowSeconds: int(1, 86_400).default(900),
    })
    .prefault({});

const rateLimitOp = (perAccount: number, perAddress: number) =>
  z
    .strictObject({
      perAccount: limitSchema(perAccount),
      perAddress: limitSchema(perAddress),
    })
    .prefault({});

const originSchema = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value;
    } catch {
      return false;
    }
  },
  { message: "must be an origin such as https://app.example.com (no path or trailing slash)" },
);

const ADAPTER_PAIRS: Record<string, string> = {
  postgresql: "prisma",
  mysql: "prisma",
  sqlite: "prisma",
  mongodb: "mongoose",
  memory: "none",
};

export const selfAuthConfigSchema = z
  .strictObject({
    specVersion: z
      .string()
      .regex(/^\d+\.\d+$/)
      .default(SPEC_VERSION),
    adapter: z.strictObject({
      backend: z.enum(["express", "fastify", "gin", "flask"]),
      frontend: z.enum(["vue", "react", "none"]).default("none"),
      database: z.enum(["postgresql", "mysql", "sqlite", "mongodb", "memory"]),
      orm: z.enum(["prisma", "mongoose", "none"]),
    }),
    authentication: z
      .strictObject({
        methods: z
          .array(z.enum(["password"]))
          .min(1)
          .default(["password"]),
        emailVerification: z
          .strictObject({
            mode: z.enum(["required", "optional", "off"]).default("required"),
            tokenTtlMinutes: int(5, 10_080).default(1_440),
          })
          .prefault({}),
        registration: z
          .strictObject({
            revealExistingEmail: z.boolean().default(false),
            signInAfterRegistration: z.boolean().default(false),
          })
          .prefault({}),
        passwordReset: z
          .strictObject({
            tokenTtlMinutes: int(5, 60).default(30),
          })
          .prefault({}),
        password: z
          .strictObject({
            minLength: int(8, 1024).default(8),
            maxLength: int(64, 1024).default(128),
            rejectCommon: z.boolean().default(true),
            hashing: z
              .strictObject({
                memoryKiB: int(ARGON2_FLOORS[0].memoryKiB, 4_194_304).default(19_456),
                iterations: int(1, 10).default(2),
                parallelism: int(1, 16).default(1),
              })
              .prefault({})
              .refine(meetsArgon2Floor, {
                message:
                  "Argon2id parameters are below the minimum (19 MiB with 2+ iterations, or 46 MiB with 1 iteration; SEC-HASH-002)",
                path: ["memoryKiB"],
              }),
          })
          .prefault({})
          .refine((p) => p.minLength <= p.maxLength, {
            message: "minLength must not exceed maxLength",
            path: ["minLength"],
          }),
        sessions: z
          .strictObject({
            strategy: z.enum(["database"]).default("database"),
            idleTimeoutMinutes: int(5, 525_600).default(10_080),
            absoluteTimeoutMinutes: int(5, 525_600).default(43_200),
            touchIntervalSeconds: int(0, 3_600).default(60),
            cookie: z
              .strictObject({
                name: z
                  .string()
                  .regex(/^[A-Za-z0-9_-]+$/)
                  .default("__Host-session"),
                sameSite: z.enum(["lax", "strict", "none"]).default("lax"),
                secure: z.boolean().default(true),
              })
              .prefault({}),
          })
          .prefault({})
          .superRefine((s, ctx) => {
            if (s.idleTimeoutMinutes > s.absoluteTimeoutMinutes) {
              ctx.addIssue({
                code: "custom",
                message: "idleTimeoutMinutes must not exceed absoluteTimeoutMinutes",
                path: ["idleTimeoutMinutes"],
              });
            }
            if (s.cookie.name.startsWith("__Host-") && !s.cookie.secure) {
              ctx.addIssue({
                code: "custom",
                message:
                  "__Host- cookies require secure: true; use another name for local http development",
                path: ["cookie", "name"],
              });
            }
            if (s.cookie.sameSite === "none" && !s.cookie.secure) {
              ctx.addIssue({
                code: "custom",
                message: "sameSite 'none' requires secure: true",
                path: ["cookie", "sameSite"],
              });
            }
          }),
        rateLimit: z
          .strictObject({
            login: rateLimitOp(5, 100),
            passwordChange: rateLimitOp(5, 100),
            register: rateLimitOp(3, 20),
            passwordResetRequest: rateLimitOp(3, 20),
            verificationResend: rateLimitOp(3, 20),
          })
          .prefault({}),
      })
      .prefault({}),
    authorization: z
      .strictObject({
        strategy: z.enum(["rbac"]).default("rbac"),
        permissions: z.array(z.string().regex(PERMISSION_PATTERN)).default([]),
        roles: z
          .record(z.string().regex(ROLE_NAME_PATTERN), z.array(z.string()))
          .default({ user: [] }),
        defaultRoles: z.array(z.string()).min(1).default(["user"]),
        reauthenticationWindowMinutes: int(1, 1_440).default(15),
      })
      .prefault({})
      .superRefine((a, ctx) => {
        const defined = new Set<string>();
        a.permissions.forEach((p, i) => {
          if (p.startsWith("auth.")) {
            ctx.addIssue({
              code: "custom",
              message: "the 'auth.' prefix is reserved for system permissions",
              path: ["permissions", i],
            });
          }
          if (defined.has(p)) {
            ctx.addIssue({
              code: "custom",
              message: `duplicate permission '${p}'`,
              path: ["permissions", i],
            });
          }
          defined.add(p);
        });
        const system = new Set<string>(SYSTEM_PERMISSIONS);
        for (const [role, perms] of Object.entries(a.roles)) {
          perms.forEach((p, i) => {
            if (!defined.has(p) && !system.has(p)) {
              ctx.addIssue({
                code: "custom",
                message: `role '${role}' references undefined permission '${p}'`,
                path: ["roles", role, i],
              });
            }
          });
        }
        a.defaultRoles.forEach((r, i) => {
          if (r === "admin") {
            ctx.addIssue({
              code: "custom",
              message: "'admin' must not be a default role (AUTHZ-ADMIN-005)",
              path: ["defaultRoles", i],
            });
          } else if (!(r in a.roles)) {
            ctx.addIssue({
              code: "custom",
              message: `default role '${r}' is not defined in roles`,
              path: ["defaultRoles", i],
            });
          }
        });
      }),
    http: z
      .strictObject({
        bodyLimitBytes: int(1_024, 1_048_576).default(16_384),
        basePath: z
          .string()
          .regex(/^\/[A-Za-z0-9/_-]*$/)
          .default("/auth"),
        trustedOrigins: z.array(originSchema).default([]),
        trustProxy: z
          .union([z.literal(false), int(1, 32), z.array(z.string().min(1)).min(1)])
          .default(false),
        csrf: z
          .strictObject({
            mode: z.enum(["header", "token"]).default("header"),
            headerName: z
              .string()
              .regex(/^[A-Za-z0-9-]+$/)
              .default("X-SelfAuth-CSRF"),
          })
          .prefault({}),
      })
      .prefault({}),
  })
  .superRefine((c, ctx) => {
    // A Go or Python backend uses no ORM; every other backend pairs each database with its ORM.
    const expectedOrm =
      c.adapter.backend === "gin" || c.adapter.backend === "flask"
        ? "none"
        : ADAPTER_PAIRS[c.adapter.database];
    if (expectedOrm !== c.adapter.orm) {
      ctx.addIssue({
        code: "custom",
        message: `orm '${c.adapter.orm}' is not supported with database '${c.adapter.database}'`,
        path: ["adapter", "orm"],
      });
    }
    if (c.authentication.sessions.cookie.sameSite === "none" && c.http.csrf.mode !== "token") {
      ctx.addIssue({
        code: "custom",
        message: "sameSite 'none' requires http.csrf.mode 'token' (SEC-COOKIE-005, SEC-CSRF-004)",
        path: ["http", "csrf", "mode"],
      });
    }
    const reg = c.authentication.registration;
    if (reg.signInAfterRegistration) {
      if (!reg.revealExistingEmail) {
        ctx.addIssue({
          code: "custom",
          message:
            "signInAfterRegistration requires revealExistingEmail: true, because an immediate session reveals whether the email was new (AUTHN-REG-012)",
          path: ["authentication", "registration", "signInAfterRegistration"],
        });
      }
      if (c.authentication.emailVerification.mode === "required") {
        ctx.addIssue({
          code: "custom",
          message:
            "signInAfterRegistration is not possible with emailVerification.mode 'required' (users are pending until verified)",
          path: ["authentication", "registration", "signInAfterRegistration"],
        });
      }
    }
    const [major] = c.specVersion.split(".");
    if (major !== SPEC_VERSION.split(".")[0]) {
      ctx.addIssue({
        code: "custom",
        message: `specVersion ${c.specVersion} is not supported (this package implements ${SPEC_VERSION})`,
        path: ["specVersion"],
      });
    }
  });

/** Configuration as written by the developer (defaults optional). */
export type SelfAuthConfigInput = z.input<typeof selfAuthConfigSchema>;
/** Fully resolved configuration with defaults applied. */
export type SelfAuthConfig = z.output<typeof selfAuthConfigSchema>;

/** Identity helper giving editor completion in `selfauth.config.ts`. */
export function defineConfig(config: SelfAuthConfigInput): SelfAuthConfigInput {
  return config;
}

/** Validate and resolve a configuration; throws a ZodError on invalid input. */
export function parseConfig(config: unknown): SelfAuthConfig {
  return selfAuthConfigSchema.parse(config);
}

/** JSON Schema (input shape) for adapters written in other languages. */
export function configJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(selfAuthConfigSchema, { io: "input", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
}
