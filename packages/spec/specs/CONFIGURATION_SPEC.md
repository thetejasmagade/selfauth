# Configuration specification

- **specVersion:** 0.1 (draft — open for review)
- **Machine-readable form:** `selfAuthConfigSchema` exported by `@selfauth/spec`
  (Zod; a JSON Schema is exported for non-TypeScript adapters).

The project configuration file (e.g. `selfauth.config.ts`) is committed to the
application repository. It holds **behavior**, never **secrets**.

## Rules

- **[CONF-FILE-001]** (MUST) Configuration MUST be validated before use; unknown
  keys MUST be rejected (typos in security settings must not be silently
  ignored).
- **[CONF-FILE-002]** (MUST NOT) The configuration file MUST NOT contain secrets
  ([SEC-SECRET-001]); secrets come from environment variables.
- **[CONF-FILE-003]** (MUST) Values outside the bounds below MUST be rejected,
  not clamped.
- **[CONF-FILE-004]** (MUST) The configuration MUST be validated against the
  selected adapter's capabilities (e.g. an adapter that does not support
  `optional` verification mode rejects it).
- **[CONF-FILE-005]** (MUST) Configuration records the `specVersion` it targets;
  an adapter MUST refuse a major `specVersion` it does not implement.

## Schema

| Key | Type | Default | Bounds / notes |
| --- | --- | --- | --- |
| `specVersion` | string `"MAJOR.MINOR"` | `"0.1"` | |
| `adapter.backend` | `"express"` | — (required) | MVP |
| `adapter.frontend` | `"vue" \| "react" \| "none"` | `"none"` | |
| `adapter.database` | `"postgresql" \| "mongodb"` | — (required) | |
| `adapter.orm` | `"prisma" \| "mongoose"` | — (required) | postgresql↔prisma, mongodb↔mongoose |
| `authentication.methods` | `["password"]` | `["password"]` | MVP supports only `password` |
| `authentication.emailVerification.mode` | `"required" \| "optional" \| "off"` | `"required"` | |
| `authentication.emailVerification.tokenTtlMinutes` | int | `1440` (24 h) | 5 – 10080 (7 days) |
| `authentication.passwordReset.tokenTtlMinutes` | int | `30` | 5 – 60 |
| `authentication.password.minLength` | int | `12` | ≥ 8, ≤ `maxLength` |
| `authentication.password.maxLength` | int | `128` | 64 – 1024 |
| `authentication.password.rejectCommon` | boolean | `true` | offline list |
| `authentication.sessions.strategy` | `"database"` | `"database"` | ADR 0008 |
| `authentication.sessions.idleTimeoutMinutes` | int | `10080` (7 days) | 5 – `absoluteTimeoutMinutes` |
| `authentication.sessions.absoluteTimeoutMinutes` | int | `43200` (30 days) | 5 – 525600 (365 days) |
| `authentication.sessions.cookie.name` | string | `"__Host-session"` | `__Host-` prefix requires `secure: true` |
| `authentication.sessions.cookie.sameSite` | `"lax" \| "strict" \| "none"` | `"lax"` | `none` requires `csrf.mode = "token"` |
| `authentication.sessions.cookie.secure` | boolean | `true` | `false` only for localhost development |
| `authentication.rateLimit.<op>.perAccount` | `{limit, windowSeconds}` | see below | limit ≥ 1; window 1 – 86400 |
| `authentication.rateLimit.<op>.perAddress` | `{limit, windowSeconds}` | see below | |
| `authorization.strategy` | `"rbac"` | `"rbac"` | |
| `authorization.permissions` | string[] | `[]` | AUTHZ-PERM-001 format; no `auth.` prefix; unique |
| `authorization.roles` | `{ [role]: string[] }` | `{ user: [] }` | permissions must be defined or `auth.*` system permissions |
| `authorization.defaultRoles` | string[] | `["user"]` | must name defined roles; MUST NOT include `admin` |
| `http.basePath` | string | `"/auth"` | starts with `/` |
| `http.trustedOrigins` | string[] (origins) | `[]` | used by CSRF origin check and CORS |
| `http.trustProxy` | `false \| int \| string[]` | `false` | hop count or proxy CIDRs |
| `http.csrf.mode` | `"header" \| "token"` | `"header"` | SEC-CSRF-004 |
| `http.csrf.headerName` | string | `"X-SelfAuth-CSRF"` | |

Rate-limit operations (`<op>`) and defaults (limit per window, window 900 s):

| op | perAccount | perAddress |
| --- | --- | --- |
| `login` | 5 | 100 |
| `passwordChange` | 5 | 100 |
| `register` | 3 | 20 |
| `passwordResetRequest` | 3 | 20 |
| `verificationResend` | 3 | 20 |

## Environment variables

Names are the defaults used by generated code; applications may rename them.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SELFAUTH_APP_BASE_URL` | Yes | Absolute URL used to build email links (AUTHN-VERIFY-009) |
| `SELFAUTH_CSRF_SECRET` | When `csrf.mode = "token"` | ≥ 32 random bytes, base64url |
| `SELFAUTH_CSRF_SECRET_PREVIOUS` | No | Previous key during rotation |
| `NODE_ENV` (or adapter equivalent) | Yes | `production` enables strict checks (SEC-COOKIE-003) |
| `DATABASE_URL` | App-owned | Used by the app's ORM; SelfAuth does not define it |

Email delivery is an application-provided adapter; its credentials are
application-owned environment variables.

## Example

```ts
import { defineConfig } from "@selfauth/spec";

export default defineConfig({
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
      admin: ["users.manage"],
    },
  },
  http: { trustedOrigins: ["https://app.example.com"] },
});
```
