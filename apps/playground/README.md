# SelfAuth playground — Express reference implementation

This app is where the SelfAuth Express implementation is built and proven
against the specification. `src/auth/` is **application-owned code**: it is
exactly what the generator will later write into a project (Phase 6), and it
has no runtime dependency on SelfAuth packages.

## Status

- All **87 conformance cases** pass (`test/conformance/`), plus unit and
  adapter tests.
- Storage: **PostgreSQL via Prisma** when `DATABASE_URL` is set, otherwise
  in-memory. All 87 cases pass on both.
- Email: `DevConsoleMailer` prints links in development and refuses to run in
  production. Supply your own `Mailer` for real delivery.
- The playground server refuses `NODE_ENV=production`.

## Run it

```bash
cp .env.example .env            # set DATABASE_URL for PostgreSQL, or remove it for memory
pnpm --filter @selfauth/playground generate
pnpm --filter @selfauth/playground db:plan      # review pending migrations
pnpm --filter @selfauth/playground db:migrate   # apply (refuses destructive changes unless --approve-destructive)
pnpm --filter @selfauth/playground db:seed      # sync roles from selfauth.config.ts
pnpm --filter @selfauth/playground dev
pnpm --filter @selfauth/playground db:create-admin you@example.com   # after registering
```

The server never migrates or seeds on startup. Other commands: `db:status`,
`db:validate` (schema + ownership manifest), `db:migrate:create <name>`
(new migration from schema.prisma changes, not applied), `db:rollback`
(recovery guidance — Prisma has no automatic down migrations).

Integrating into an existing database that has tables but no Prisma
migration history requires a baseline first (Prisma error P3005);
`db:migrate` prints the steps.

Locally the session cookie is `dev_session` without `Secure` (plain http);
production configuration uses `__Host-session` with `Secure`.

```bash
curl -s -c jar -b jar -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' \
  localhost:3000/auth/register -d '{"email":"me@example.test","password":"correct horse battery staple"}'
# copy the token from the [dev mail] output, then:
curl -s -c jar -b jar -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' \
  localhost:3000/auth/email/verify -d '{"token":"<token>"}'
curl -s -c jar -b jar -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' \
  localhost:3000/auth/login -d '{"email":"me@example.test","password":"correct horse battery staple"}'
curl -s -c jar -b jar -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' \
  localhost:3000/api/notes -d '{"text":"hello"}'
```

Routes follow the HTTP binding in
[`AUTHENTICATION_SPEC §11`](../../packages/spec/specs/AUTHENTICATION_SPEC.md#11-http-binding-non-normative-used-by-mvp-adapters).

## Layout

```text
src/auth/
├── core/            framework-independent
│   ├── service.ts       all flows: registration … admin operations
│   ├── authorization.ts RBAC, resource policies, ownership helper
│   ├── password.ts      Argon2id (ADR 0014) + password policy
│   ├── rate-limit.ts    limiter with back-off (ADR 0015)
│   ├── store.ts         persistence contract (implemented per database)
│   ├── mailer.ts, logger.ts, crypto.ts, email.ts, clock.ts, errors.ts
├── stores/memory.ts in-memory store (dev/test)
├── stores/prisma.ts PostgreSQL store + shared rate-limit store
├── express/index.ts cookies, CSRF, CORS, session middleware, guards, routes
└── index.ts         createAuth(), syncRoles()
src/example/notes.ts example app module using guards and ownership
```

## Using it in routes

```ts
const routes = auth.protectedRoutes();             // deny unless a guard allows
routes.post("/", auth.requirePermission("notes.create"), handler);
routes.get("/:id", auth.authorizeResource("notes.view", (req) => ({ type: "note", id: req.params.id })), handler);
auth.policies.register("note", ownershipPolicy(loadNote));
```

## Known limitations

- The in-memory store is single-process only; use PostgreSQL for more than one instance.
- The bundled common-password list is a small starter list; replace it with a
  larger offline list.
- Registration in `off` mode sends the "account exists" notice only on the
  existing-email path; with a slow real mail provider, queue mail so timing
  stays uniform (SEC-ENUM-003).
