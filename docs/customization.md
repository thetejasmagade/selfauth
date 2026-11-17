# Customization and extension points

The generated code is yours, so you can change anything. These are the
supported seams. Changes there are expected, and the security core stays as
it was tested.

## 1. Configuration: `selfauth.config.ts`

Behaviour, never secrets. It is validated against the spec's bounds at
startup, so a weak setting fails fast instead of shipping. The full reference
is [`CONFIGURATION_SPEC.md`](../packages/spec/specs/CONFIGURATION_SPEC.md).
Common changes:

| Setting | Default | Notes |
| --- | --- | --- |
| `authorization.permissions`, `roles`, `defaultRoles` | (yours) | Declare every permission. `requirePermission` rejects unknown ones at startup. Re-run the seed after changes (PostgreSQL). |
| `authentication.emailVerification.mode` | `required` | `optional` lets users in before they verify (`selfauth doctor` warns) |
| `authentication.registration.revealExistingEmail` / `signInAfterRegistration` | `false` | Opt-in UX trade-offs that weaken enumeration safety (SEC-ENUM-004) |
| `authentication.password.minLength`, `rejectCommon`, `hashing` | 8, `true`, Argon2id 19 MiB × 2 | Hashing below the OWASP floor is rejected. With a frontend, also update its pages (see [Changing the password length](#changing-the-password-length)) |
| `authentication.sessions.idleTimeoutMinutes` / `absoluteTimeoutMinutes` | 7 days / 30 days | |
| `authentication.sessions.cookie` | `__Host-session`, `lax`, `secure` | `sameSite: "none"` only for cross-site deployments, with token-mode CSRF |
| `authentication.rateLimit.*` | per account and per address | Limits and windows for each endpoint |
| `http.basePath`, `trustedOrigins`, `trustProxy`, `bodyLimitBytes` | `/auth`, —, `false`, 16 KiB | |
| `http.csrf.mode` | `header` | `token` for cross-site frontends; needs `SELFAUTH_CSRF_SECRET` |

### Changing the password length

The server decides: `authentication.password.minLength` (and `maxLength`) in
`server/src/config/selfauth.config.ts`, or `src/config/selfauth.config.ts` in an
API-only project. It cannot go below 8 (`npx selfauth validate` says so), and you
restart the server after changing it.

The frontend does not read that file. Its forms only carry a browser hint of the
length, so after changing the server, update the three pages that show it, or the
browser will keep asking for the old length before the form is even sent:

| Page | Vue (`client/src/`) | React (`client/src/`) | What to change |
| --- | --- | --- | --- |
| Register | `pages/auth/RegisterPage.vue` | `pages/auth/RegisterPage.tsx` | the `minlength` / `minLength` attribute, and the text "At least 8 characters" |
| Reset password | `pages/auth/ResetPasswordPage.vue` | `pages/auth/ResetPasswordPage.tsx` | the `minlength` / `minLength` attribute |
| Account (change password) | `pages/AccountPage.vue` | `pages/AccountPage.tsx` | the `minlength` / `minLength` attribute |

Restart the dev server (or rebuild the client) afterwards. The server stays the
authority: a password shorter than its limit is refused even if the form lets it
through, and the error message shows the server's number.

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
