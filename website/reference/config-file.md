---
title: The configuration file
description: Every option of selfauth.config.ts and selfauth.config.json with its type, default value and allowed range. Covers sessions, password hashing, rate limits, authorization and HTTP settings.
keywords: [selfauth.config.ts, configuration, options, defaults, session timeout, password policy, argon2, rate limit, csrf, trustProxy]
---

# The configuration file

Everything about how the authentication code behaves is configuration, so you rarely need to edit the code itself. Secrets never go in this file. They come from [environment variables](./environment).

| Backend | File | Format |
| --- | --- | --- |
| Express, Fastify | `src/config/selfauth.config.ts` (full stack: `server/src/...`) | A TypeScript object named `config` |
| Gin | `selfauth.config.json` in the project root | JSON. The server finds it in the current directory, or at the path in `SELFAUTH_CONFIG` |

## How it's checked

The configuration is validated when the server starts, and the rules are strict:

- Unknown keys are rejected, so a typo in a security setting can't be silently ignored.
- Values outside the allowed range are rejected, not quietly adjusted. A weak setting fails fast instead of shipping.
- Cross-field rules apply too. A `__Host-` cookie name, for example, needs `secure: true`.

You can check the file at any time without starting the server:

```bash
npx selfauth validate
```

```text
  ✓ selfauth configuration is valid
```

A bad value fails with a message that names the key (real output):

```text
  ✗ config authentication.password.minLength: Too small: expected number to be >=8
  ✗ config authentication.sessions.cookie: Unrecognized key: "bogus"
```

Restart the server after every change. The file is only read at startup.

## Full example (the generated defaults)

```ts
export const config: SelfAuthConfig = {
  specVersion: "0.1",
  adapter: { backend: "express", frontend: "none", database: "postgresql", orm: "prisma" },
  authentication: {
    methods: ["password"],
    emailVerification: { mode: "required", tokenTtlMinutes: 1440 },
    registration: { revealExistingEmail: false, signInAfterRegistration: false },
    passwordReset: { tokenTtlMinutes: 30 },
    password: {
      minLength: 8,
      maxLength: 128,
      rejectCommon: true,
      hashing: { memoryKiB: 19456, iterations: 2, parallelism: 1 },
    },
    sessions: {
      strategy: "database",
      idleTimeoutMinutes: 10080,
      absoluteTimeoutMinutes: 43200,
      touchIntervalSeconds: 60,
      cookie: { name: "__Host-session", sameSite: "lax", secure: true },
    },
    rateLimit: { /* see Rate limits */ },
  },
  authorization: {
    strategy: "rbac",
    permissions: [],
    roles: { user: [], admin: [] },
    defaultRoles: ["user"],
    reauthenticationWindowMinutes: 15,
  },
  http: {
    bodyLimitBytes: 16384,
    basePath: "/auth",
    trustedOrigins: [],
    trustProxy: false,
    csrf: { mode: "header", headerName: "X-SelfAuth-CSRF" },
  },
};
```

(The keys are quoted in the real file, which is JSON-like.)

## `adapter`

This describes the project and `init` sets it. Don't change it by hand, because it has to match the code that was generated.

| Key | Values | Notes |
| --- | --- | --- |
| `adapter.backend` | `express`, `fastify`, `gin` | Required |
| `adapter.frontend` | `vue`, `react`, `none` | Default `none` |
| `adapter.database` | `postgresql`, `mysql`, `sqlite`, `mongodb`, `memory` | Required. `memory` is for development only |
| `adapter.orm` | `prisma`, `mongoose`, `none` | Required. PostgreSQL, MySQL and SQLite pair with `prisma`, MongoDB with `mongoose`, memory with `none`. The `gin` backend uses `none` |

## Authentication

### `authentication.methods`

It's `["password"]`, since email and password is the only method implemented.

### Email verification

| Key | Default | Range | Meaning |
| --- | --- | --- | --- |
| `emailVerification.mode` | `"required"` | `required`, `optional`, `off` | `required`: accounts start `pending` until the link is used. `optional` or `off`: accounts are active immediately (`selfauth doctor` warns) |
| `emailVerification.tokenTtlMinutes` | `1440` (24 h) | 5 – 10080 | How long a verification link works |

### Registration

| Key | Default | Meaning |
| --- | --- | --- |
| `registration.revealExistingEmail` | `false` | `true` answers `409 EMAIL_TAKEN` for a known email. Friendlier, but it lets anyone find out who has an account |
| `registration.signInAfterRegistration` | `false` | `true` signs the user in right after registering. Requires `revealExistingEmail: true` and verification mode `optional` or `off` |

### Password reset

| Key | Default | Range |
| --- | --- | --- |
| `passwordReset.tokenTtlMinutes` | `30` | 5 – 60 |

### Password

| Key | Default | Range | Meaning |
| --- | --- | --- | --- |
| `password.minLength` | `8` | 8 – `maxLength` | Shortest accepted password (Unicode characters) |
| `password.maxLength` | `128` | 64 – 1024 | Longest accepted password |
| `password.rejectCommon` | `true` | | Refuse passwords from a list of very common ones |
| `password.hashing.memoryKiB` | `19456` (19 MiB) | at least 19456 when `iterations` ≥ 2; at least 47104 when `iterations` = 1 | Argon2id memory cost |
| `password.hashing.iterations` | `2` | 1 – 10 | Argon2id time cost |
| `password.hashing.parallelism` | `1` | 1 – 16 | Argon2id lanes |

Hashing cost can't go below the OWASP minimums. Raising it makes every login slower and uses more memory per attempt, so test under load.

The server is what enforces the length, but the frontend forms carry a browser hint. After raising `minLength`, update the `minlength` attribute on the register, reset password and account pages. See [Add a frontend page](/express/frontend-page).

### Sessions

| Key | Default | Range | Meaning |
| --- | --- | --- | --- |
| `sessions.strategy` | `"database"` | `database` | Sessions are rows in your database |
| `sessions.idleTimeoutMinutes` | `10080` (7 days) | 5 – `absoluteTimeoutMinutes` | A session ends after this long without use |
| `sessions.absoluteTimeoutMinutes` | `43200` (30 days) | 5 – 525600 | A session ends this long after sign-in, however busy |
| `sessions.touchIntervalSeconds` | `60` | 0 – 3600 | Minimum time between database writes that extend the idle timeout |
| `sessions.cookie.name` | `"__Host-session"` | | A `__Host-` name requires `secure: true` |
| `sessions.cookie.sameSite` | `"lax"` | `lax`, `strict`, `none` | `none` requires `csrf.mode: "token"` and `secure: true` |
| `sessions.cookie.secure` | `true` | | `false` only for localhost. Refused in production |

In development the cookie is called `dev_session` and isn't `Secure`. `localDevelopmentConfig` applies that outside production, because browsers refuse `Secure` cookies on plain `http`.

### Rate limits

<a id="rate-limits"></a>

Each operation is limited per account and per address, within a window measured in seconds. The defaults use a 900 second (15 minute) window:

| Operation (`rateLimit.<op>`) | `perAccount` limit | `perAddress` limit |
| --- | --- | --- |
| `login` | 5 | 100 |
| `passwordChange` | 5 | 100 |
| `register` | 3 | 20 |
| `passwordResetRequest` | 3 | 20 |
| `verificationResend` | 3 | 20 |

Both `perAccount` and `perAddress` are objects shaped `{ limit, windowSeconds }`, where `limit` is at least 1 and `windowSeconds` is between 1 and 86400. A stricter login limit looks like this:

```ts
rateLimit: {
  login: {
    perAccount: { limit: 3, windowSeconds: 900 },
    perAddress: { limit: 50, windowSeconds: 900 },
  },
  // keep the other operations: you must list them all
}
```

When a limit is hit you get `429 RATE_LIMITED` with a `Retry-After` header. The attempt is counted before the password is checked, so guesses can't outrun the limit.

::: warning Behind a proxy

Per-address limits use the client's address. Behind a reverse proxy or load balancer, set `http.trustProxy`, or every user appears to come from the proxy and they all share one limit.

:::

## Authorization

| Key | Default | Meaning |
| --- | --- | --- |
| `authorization.strategy` | `"rbac"` | Role-based access control |
| `authorization.permissions` | `[]` | Your permissions: `area.action`, lowercase, no `auth.` prefix, unique |
| `authorization.roles` | `{ user: [], admin: [] }` | Role name → list of permissions. Permissions must be declared above (or be `auth.*` system permissions) |
| `authorization.defaultRoles` | `["user"]` | Roles new accounts receive. Must exist and must not include `admin` |
| `authorization.reauthenticationWindowMinutes` | `15` (1 – 1440) | How recently an admin must have entered their password to use admin routes |

See [Permissions and roles](/express/permissions), and re-run the seed after changing roles.

## HTTP

| Key | Default | Range | Meaning |
| --- | --- | --- | --- |
| `http.basePath` | `"/auth"` | starts with `/` | Where the authentication routes are served. The frontend client must use the same value |
| `http.bodyLimitBytes` | `16384` (16 KiB) | 1024 – 1048576 | Larger bodies get `413 PAYLOAD_TOO_LARGE` |
| `http.trustedOrigins` | `[]` | list of origins | Origins allowed by the CSRF origin check and by CORS (with cookies). The origin of `SELFAUTH_APP_BASE_URL` is always trusted |
| `http.trustProxy` | `false` | `false`, a number of hops, or a list of proxy addresses | Whether to believe `X-Forwarded-For` |
| `http.csrf.mode` | `"header"` | `header`, `token` | `header`: a fixed header. `token`: a signed token bound to the session, required for cross-site setups |
| `http.csrf.headerName` | `"X-SelfAuth-CSRF"` | | Name of the CSRF header |

[Frontend deployment](./frontend-deployment) explains which setup needs which settings.

## Common recipes

::: details Shorter sessions (sign out after one day idle, seven days total)

```ts
sessions: {
  strategy: "database",
  idleTimeoutMinutes: 1440,
  absoluteTimeoutMinutes: 10080,
  touchIntervalSeconds: 60,
  cookie: { name: "__Host-session", sameSite: "lax", secure: true },
},
```

:::

::: details Longer minimum password

```ts
password: { minLength: 12, maxLength: 128, rejectCommon: true,
            hashing: { memoryKiB: 19456, iterations: 2, parallelism: 1 } },
```

Then update the frontend forms to match.

:::

::: details Behind one reverse proxy

```ts
http: { /* ... */ trustProxy: 1 },
```

:::

::: details Frontend on a sibling subdomain

```ts
http: { /* ... */ trustedOrigins: ["https://app.example.com"] },
```

:::
