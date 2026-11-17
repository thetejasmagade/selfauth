<!-- Generated from docs/customization.md by skills/scripts/sync-references.mjs. Do not edit; edit the guide. -->

# Customization and extension points

The generated code is yours, so you can change anything. These are the
supported seams. Changes there are expected, and the security core stays as
it was tested.

## 1. Configuration: `selfauth.config.ts`

Behaviour, never secrets. It is validated against the spec's bounds at
startup, so a weak setting fails fast instead of shipping. The full reference
is [`CONFIGURATION_SPEC.md`](../configuration.md).
Common changes:

| Setting | Default | Notes |
| --- | --- | --- |
| `authorization.permissions`, `roles`, `defaultRoles` | (yours) | Declare every permission. `requirePermission` rejects unknown ones at startup. Re-run the seed after changes (PostgreSQL). |
| `authentication.emailVerification.mode` | `required` | `optional` lets users in before they verify (`selfauth doctor` warns) |
| `authentication.registration.revealExistingEmail` / `signInAfterRegistration` | `false` | Opt-in UX trade-offs that weaken enumeration safety (SEC-ENUM-004) |
| `authentication.password.minLength`, `rejectCommon`, `hashing` | 8, `true`, Argon2id 19 MiB × 2 | Hashing below the OWASP floor is rejected. In a full-stack project the password length limits live in the root `selfauth.config.json` instead (see below) |
| `authentication.sessions.idleTimeoutMinutes` / `absoluteTimeoutMinutes` | 7 days / 30 days | |
| `authentication.sessions.cookie` | `__Host-session`, `lax`, `secure` | `sameSite: "none"` only for cross-site deployments, with token-mode CSRF |
| `authentication.rateLimit.*` | per account and per address | Limits and windows for each endpoint |
| `http.basePath`, `trustedOrigins`, `trustProxy`, `bodyLimitBytes` | `/auth`, —, `false`, 16 KiB | |
| `http.csrf.mode` | `header` | `token` for cross-site frontends; needs `SELFAUTH_CSRF_SECRET` |

### Password length in a full-stack project: `selfauth.config.json`

A project made with `--frontend vue|react` has a second, much smaller file in
the project root: `selfauth.config.json`. It holds only settings the browser
needs too (today: `password.minLength` and `password.maxLength`), and **it is
the one place to change them**:

```json
{ "password": { "minLength": 10, "maxLength": 128 } }
```

`server/src/config/selfauth.config.ts` imports the limits from it, and the
frontend's register, reset and account screens use the same numbers for the
input hint and the "at least N characters" text. Nothing else about the
server's behaviour is in that file, and it must never hold secrets.

Each package imports a copy inside its own folder
(`server/src/config/selfauth.config.json`, `client/src/selfauth.config.json`).
`npm run sync` writes the copies, and `dev`, `build`, `test` and `typecheck` run
it first, so editing the root file and restarting is enough; a built client
needs a rebuild. To move a package out of the workspace into its own repository,
delete its `sync` and `pre*` scripts; its copy of the file then simply stays as
it is. `selfauth doctor` warns when a copy is stale. The specification's
floor still applies: a `minLength` below 8 fails `selfauth validate` and the
server's start-up check.

## 2. Email: `email/mailer.ts`

Implement `Mailer` (`send(message)`). A message has `kind`, `to`, `subject`,
`text` and `link?`. Swap in your provider:

```ts
export function createMailer(env: Env): Mailer {
  if (env.nodeEnv !== "production") return new DevConsoleMailer(env.nodeEnv);
  return {
    async send(m) {
      await provider.send({ to: m.to, subject: m.subject, text: m.text }); // never log m.link
    },
  };
}
```

Change wording and templates freely, branching on `m.kind`. Keep the link
exactly as given: it carries the token in the fragment.

## 3. Your routes and resources

- Guard routes with `requireAuth`, `requirePermission` and
  `authorizeResource`, or use `protectedRoutes()` for deny-by-default
  routers.
- Register a policy per resource type: `auth.policies.register(type, policy)`.
  `ownershipPolicy(load)` covers the "owner or `*_any`" case. For anything
  else (tenants, status, sharing), write your own
  `{ load, authorize(subject, action, resource) }`. `load` must read from
  your database, never from the request.
- Filter lists in the query with `ownerFilter()`, or with the equivalent
  condition in your own policy.

See [server API](api/server.md).

## 4. Storage: `store.ts`

`AuthStore` (`auth/core/store.ts`) is the persistence interface. The shipped
implementations are `PrismaAuthStore` (PostgreSQL) and `MemoryAuthStore`. To
use another database, implement `AuthStore` and run the conformance suite
(`@selfauth/conformance`) against your app. That suite is how the shipped
stores are proven. `RateLimitStore` is separate: its `update()` must be
atomic across instances (see `PrismaRateLimitStore`).

## 5. Frontend: `client/src/auth/`

`messages.ts` holds user-facing error text (localize here). The pages under
`client/src/pages/` are yours to restyle (the five account screens are in
`pages/auth/`; your own pages go in `pages/`). `client.ts` is framework-neutral if
you build your own UI. Keep the CSRF header and `credentials` handling.

## 6. Logging and audit

Security events go to `auth_security_events` (`store.recordEvent`) and
through the redacting logger. You may forward them to your SIEM. The
redaction rules are in SEC-LOG-001; keep them.

## What not to change (without understanding why)

`auth/core/**` holds hashing, token generation, session rotation, CSRF, rate
limiting, timing equalization and enumeration-safe errors. It is
conformance-tested as a unit. If you must change it:

- run the conformance suite;
- expect `selfauth validate` to list the file as changed;
- expect `selfauth upgrade` to write `.selfauth-new` proposals for it
  instead of updating it.
