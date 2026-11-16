# SelfAuth playground — Express reference implementation

This app is where the SelfAuth Express implementation is built and proven
against the specification. `src/auth/` is **application-owned code**: it is
exactly what the generator will later write into a project (Phase 6), and it
has no runtime dependency on SelfAuth packages.

## Status

- All **87 conformance cases** pass (`test/conformance/`), plus unit and
  adapter tests.
- Storage: **in-memory only**. PostgreSQL + Prisma arrive in Phase 4.
- Email: `DevConsoleMailer` prints links in development and refuses to run in
  production. Supply your own `Mailer` for real delivery.
- The playground server refuses `NODE_ENV=production`.

## Run it

```bash
cp .env.example .env
pnpm --filter @selfauth/playground dev
```

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

- Single-process only (memory store and memory rate-limit store).
- The bundled common-password list is a small starter list; replace it with a
  larger offline list.
- Registration in `off` mode sends the "account exists" notice only on the
  existing-email path; with a slow real mail provider, queue mail so timing
  stays uniform (SEC-ENUM-003).
