# Questions people ask

Short, checked answers, each with where the detail lives. If a question is not
covered here or in the file it points to, **say it isn't documented**. Don't
guess, and don't describe SelfAuth features from memory.

Files named `guides/…` are the user guides bundled with this skill. The
specification files (`authentication-spec.md` and the others) are normative:
when a guide and a spec disagree, the spec wins, and you should tell the
developer.

## What it is

**What is SelfAuth?** A development-time code generator. It writes email and
password authentication, sessions, roles and permissions into the developer's
own project, with tests. The developer owns the code. Nothing calls SelfAuth
when the app runs, and there is no SelfAuth server, account or runtime
package. → [architecture](architecture.md), [guides/manual-integration.md](guides/manual-integration.md)

**Is it a library I install?** No. The packages (`@selfauth/cli`, `selfauth`)
are development tools. The generated project depends on ordinary packages only
(Express, Argon2, Prisma and so on), never on `@selfauth/*`.

**What does it generate?** Registration, email verification, login, logout,
logout everywhere, session listing and revocation, password change and reset,
account deletion, roles, permissions, resource ownership checks, an
administration API, rate limiting, CSRF protection and security events.
→ [guides/api/http.md](guides/api/http.md), [authentication-spec](authentication-spec.md),
[authorization-spec](authorization-spec.md)

**Does it need an internet connection or a SelfAuth account to run?** No. Only
the generator is fetched from npm, once.

## What is supported

**Which stacks are supported?** Express 5 or Fastify 5 + TypeScript (Node.js
22.18 or newer), PostgreSQL, MySQL or SQLite through Prisma 7, MongoDB through Mongoose, or an in-memory store, and Vue or React frontends.
A new Gin (Go) project is supported too, with any database (PostgreSQL, MySQL, SQLite or MongoDB, or the in-memory store) and with or without a Vue or React frontend.
An existing Express or Fastify project can use `selfauth add`; a new one uses
`selfauth init [--backend express|fastify|gin]`. Run `selfauth list` for the
authoritative list.
→ [framework-support](framework-support.md)

**NestJS, Next.js, Koa, Django, MongoDB, MySQL, or Mongoose?** Not supported.
Say so and stop; never port the Express code or write an adapter.
MongoDB/Mongoose are planned, not built. → [framework-support](framework-support.md)

**Can I use OAuth, social login, magic links, passkeys, MFA or JWT access
tokens?** Not generated. Sessions are opaque and server-side. The
specification lists some of these as optional capabilities that no adapter
builds yet. → [framework-support](framework-support.md),
[guides/conformance.md#known-limitations](guides/conformance.md#known-limitations)

**How well tested is the Fastify backend?** All 90 conformance cases pass on it
with both stores, and CI generates and exercises Fastify projects. It is
published at the authorization level; production-profile is not claimed yet.
→ [guides/conformance-fastify.md](guides/conformance-fastify.md)

**How well tested is the Gin (Go) backend?** All 90 conformance cases pass on it with
the in-memory store and PostgreSQL, and CI generates and exercises Gin projects. It is a
separate Go implementation of the core, published at the authorization level; production-profile
is not claimed. Existing Go projects are not supported (new projects only).
→ [guides/conformance-gin.md](guides/conformance-gin.md)

**Is the in-memory store OK in production?** No. It loses data on restart and
keeps rate limits per process. The app refuses to start with it when
`NODE_ENV=production`. It is capped at authorization level.
→ [guides/conformance.md](guides/conformance.md)

## Using it

**I'm starting a new project.** `selfauth init <dir> [--backend express|fastify|gin] --database postgresql
--frontend none|vue|react --permissions a.b,c.d`. Show the `--dry-run` first.
→ SKILL.md step 6

**I have an existing Express app (or a Fastify one).** `selfauth detect`, then `selfauth add`. It
writes only new files under `<src>/selfauth/` and never edits existing files.
You make the printed edits. → [guides/existing-projects.md](guides/existing-projects.md)

**My code isn't in `src/`.** `add` finds the folder from the file that calls
`express()`, or you pass `--src server`. It stops before writing if `tsconfig`
would not compile the new folder. → [guides/existing-projects.md](guides/existing-projects.md),
[project-layouts](project-layouts.md)

**It's a monorepo.** Run each command inside the package, not at the root.
`selfauth detect` at the root lists the packages and their roles.
→ [project-layouts](project-layouts.md)

**My frontend is in another folder or repository.** Run `selfauth
add-frontend` in the frontend. It supports Vue and React, adds only the
authentication module, and generates no pages. Then decide how the browser
reaches the API. → [guides/existing-projects.md](guides/existing-projects.md),
[guides/frontend-deployment.md](guides/frontend-deployment.md)

**I use another frontend framework.** No generator. The API is documented and
the developer can write a client; that is their decision, not yours.
→ [guides/api/http.md](guides/api/http.md), [guides/api/client.md](guides/api/client.md)

**I already have authentication.** Show the file:line evidence from `detect`
and ask. `add` refuses without `--allow-existing-auth`, which you pass only
after the developer approves. SelfAuth runs next to the old system and removes
nothing. To move users over, see [guides/upgrading.md#migrating-from-another-auth-system](guides/upgrading.md#migrating-from-another-auth-system).

**Can I install it without the CLI or an AI agent?** Yes. Copy a folder from
`templates/` and use plain npm and Prisma. → [guides/manual-integration.md](guides/manual-integration.md)

**How do I protect a route?** `auth.requireAuth` (any signed-in user),
`auth.requirePermission("orders.view")`, `auth.authorizeResource(...)` for
ownership, or `auth.protectedRoutes()` for a router that denies unguarded
routes. Hiding a button in the frontend is not protection (AUTHZ-CORE-004).
→ [guides/api/server.md](guides/api/server.md), [authorization-spec](authorization-spec.md)

**How do I add a role or permission?** Declare it in `selfauth.config.ts` under
`authorization.permissions` and grant it to roles, then re-run the seed
(`npm run db:seed`, PostgreSQL). → [guides/customization.md](guides/customization.md)

**How do I create the first administrator?** `npm run db:create-admin
you@example.com` after registering that account (PostgreSQL projects).
→ [guides/manual-integration.md](guides/manual-integration.md)

**How do I send real emails?** Implement `createMailer()` in `email/mailer.ts` with
the provider's SDK. The server refuses to start in production until you do.
Never hard-code the provider's key. → [guides/customization.md](guides/customization.md)

## Security

**How are passwords stored?** Argon2id (a maintained binding, never a hand-
written implementation), with parameters at or above the OWASP floor.
→ [security-rules](security-rules.md) (SEC-HASH-001, SEC-HASH-002)

**How do sessions work?** Opaque random tokens, stored server-side only as a
hash, in an `HttpOnly`, `Secure` `__Host-session` cookie with idle and
absolute timeouts. They are revoked on logout, password change and when an
account is suspended. → [authentication-spec](authentication-spec.md)
(AUTHN-SESS-002), [security-rules](security-rules.md)

**What about CSRF?** State-changing requests must carry the custom header
`X-SelfAuth-CSRF: 1` from a trusted origin. Cross-site setups use token mode
with `SELFAUTH_CSRF_SECRET`. This covers the whole app, including the
application's own POST routes (SEC-CSRF-004). → [security-rules](security-rules.md),
[guides/frontend-deployment.md](guides/frontend-deployment.md)

**Does sign-up reveal whether an email is registered?** Not by default.
Registration never reveals it and never logs the user in. Two opt-in settings
(`revealExistingEmail`, `signInAfterRegistration`) trade that away, and
`selfauth doctor` warns (SEC-ENUM-004). → [guides/customization.md](guides/customization.md)

**Can I weaken a security setting?** Settings are checked against the
specification's bounds and out-of-range values are rejected, not clamped.
Don't edit `src/auth/**` to get around a check; configure instead.
→ [configuration](configuration.md)

**Are passwords rotated or expired?** No. Forced rotation is not required by
default and there is no setting for it (SEC-PWPOLICY-005).

**Is it production ready? Has it been audited?** The PostgreSQL store reaches
the production-profile level in CI, which is self-assessed. **No independent
security audit has been done**; one is a condition of the 1.0 release. Say
this plainly; don't call it "secure" or "audited". → [guides/conformance.md](guides/conformance.md),
[guides/security-review.md](guides/security-review.md)

**How do I report a vulnerability?** Follow `SECURITY.md` in the SelfAuth
repository; don't open a public issue.

## Database

**How do migrations work?** `selfauth db plan` shows the SQL and flags
changes that lose data and changes to SelfAuth's own tables. `selfauth db
migrate` applies them through Prisma Migrate and refuses plans with findings
unless the developer approved them. Adding tables and columns of their own needs
no approval. Nothing migrates at app start-up.
→ [guides/database.md](guides/database.md), [migration-rules](migration-rules.md)

**Will it touch my existing tables?** No. It owns only the `auth_*` tables and
types, and checks for name conflicts before changing anything.
→ [guides/database.md](guides/database.md)

**Can I roll back a migration?** Not automatically: there are no down
migrations. `selfauth db rollback` explains the procedure.
→ [migration-rules](migration-rules.md)

**What happens to data when an account is deleted?** The email and password
hash are removed; a tombstone row, role assignments and security events stay
until the owner deletes them. → [guides/data-retention.md](guides/data-retention.md)

## Deployment

**What do I have to set in production?** PostgreSQL (`DATABASE_URL`), an email
provider, `SELFAUTH_APP_BASE_URL` set to the real frontend `https://` origin,
HTTPS with HSTS (`http.trustProxy` when behind a proxy), and no `selfauth doctor` errors. → [guides/manual-integration.md](guides/manual-integration.md),
[guides/frontend-deployment.md](guides/frontend-deployment.md)

**How should the frontend reach the API?** Same origin (a proxy, one domain) is
the default and the most secure. Sibling subdomains and different sites are
supported with extra settings. Ask the developer; don't choose silently.
→ [guides/frontend-deployment.md](guides/frontend-deployment.md)

**Every POST fails with `CSRF_FAILED`.** The frontend origin isn't trusted or
the header is missing. Check `SELFAUTH_APP_BASE_URL` and `http.trustedOrigins`,
and that requests send `X-SelfAuth-CSRF: 1` (the client does).
→ [guides/frontend-deployment.md](guides/frontend-deployment.md), [errors](errors.md)

## Keeping it up to date

**How do I check my setup?** `selfauth doctor` (configuration and production
readiness) and `selfauth validate` (config schema, which generated files you
changed, the database schema). → SKILL.md, "Maintaining an existing
installation"

**How do I upgrade?** `selfauth diff`, then `selfauth upgrade`. Files you never
edited are updated; files you edited get a `<file>.selfauth-new` proposal and
are never overwritten; deleted files stay deleted. → [guides/upgrading.md](guides/upgrading.md)

**`upgrade` says my project uses the flat layout.** It was made with SelfAuth
0.3 or earlier. Commit, then `selfauth upgrade --reorganize` (try `--dry-run`
first): it moves the app files into `src/config`, `src/email`, `src/db`,
`src/http` and `src/routes` and fixes the imports. `doctor` and `validate`
work either way. → [guides/upgrading.md](guides/upgrading.md#moving-to-the-grouped-layout)

**Where do the files go in a full-stack project?** `selfauth init --frontend
vue|react` makes two packages in one npm workspace: `server/` (the API) and
`client/` (the frontend), plus a thin root with `package.json`. One `npm install`
at the root installs both and `npm run dev` starts both. Each package has its own
`selfauth.manifest.json`; `doctor`, `validate`, `diff` and `upgrade` at the root
cover both. An API-only project stays a single package with `src/`.
→ [guides/manual-integration.md](guides/manual-integration.md),
[guides/upgrading.md](guides/upgrading.md#moving-to-the-two-package-layout)

**How do I change the minimum password length?** Edit
`authentication.password.minLength` in the server's `selfauth.config.ts` (8 is
the floor; `selfauth validate` rejects less) and restart. In a project with a
frontend, also change the `minlength` attribute in `pages/auth/RegisterPage`,
`pages/auth/ResetPasswordPage` and `pages/AccountPage` (and the "At least 8
characters" text on the register page), or the browser keeps asking for the old
length. → [guides/customization.md](guides/customization.md#changing-the-password-length)

**Does upgrading change my database?** It updates files, including new
migration files. Applying migrations is a separate, reviewed step
(`selfauth db plan`). → [guides/upgrading.md](guides/upgrading.md), [guides/database.md](guides/database.md)

## Unsure what applies to a project

Run `selfauth detect` (or `scripts/detect-project.ts`) and answer from its
report. Don't infer a project's stack from its name or from the question.
