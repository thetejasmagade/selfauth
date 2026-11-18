# 0024 — Fastify is a second backend, behind the same core

- Status: accepted
- Date: 2026-11-17

## Context

Phase 10 adds frameworks. SelfAuth's core (`auth/core`: service, hashing, sessions, rate limiting,
authorization), its stores (memory, Prisma) and its configuration were already framework-neutral;
only `auth/express/index.ts`, `app.ts`, `server.ts` and the example routes knew about Express. Fastify
is the smallest step from there and the most requested.

## Decision

- **A second reference implementation, `apps/playground-fastify`.** It holds the Fastify adapter
  (`src/auth/fastify/index.ts`), `app.ts`, `server.ts`, the request-id helper and the example notes
  module, plus its own tests. Everything else (core, stores, config loading, mailer, db wiring,
  scripts, Prisma schema and migrations, spec types) is a **copy** of the Express app's file, and a
  test (`test/shared-files.test.ts`) fails if a copy drifts, so a fix to the core lands in both
  apps. Copies rather than a shared package keep ADR 0018 intact: each template is a byte-for-byte
  copy of one tested app, and no SelfAuth runtime package exists.
- **Same behaviour, Fastify idioms.** The adapter has the same guards and the same
  deny-by-default `protectedRoutes`, but a Fastify shape: `auth.install(app)` adds the CORS, session
  and CSRF hooks and the routes; guards are async `preHandler` functions that throw `AuthError`;
  `auth.handleError` is called from the app's error handler; `protectedRoutes(app, prefix)`
  registers on the app (no router to mount). The JSON body parser is replaced so an empty body is
  accepted and a malformed one is `400 VALIDATION_FAILED`, as in Express. Request ids are generated
  by Fastify and never read from a header. A hop-count `http.trustProxy` is converted to the
  function Fastify expects.
- **Conformance is measured, not assumed.** All 87 cases pass on Fastify with the memory store and
  with PostgreSQL. `conformance/adapters/fastify.json` carries the same sign-offs as Express, with
  evidence in the Fastify app (its auth, app and PostgreSQL tests are ports of the Express ones).
  Fastify claims **authorization** level for both stores. It does not claim production-profile yet:
  its adapter has had one review pass, by its author. `docs/conformance-fastify.md` is generated
  from the record, like the Express matrix.
- **The spec allows it.** `adapter.backend` is `"express" | "fastify"` in the configuration schema.
  The manifest records `options.backend` (Express when absent), so `upgrade` re-plans from the
  right templates.
- **CLI.** `selfauth init --backend express|fastify` (default Express); `list` shows both. Full-stack
  Fastify projects use the same two-package layout (ADR 0023) with the unchanged Vue and React
  frontends. Manual templates `fastify/`, `fastify-vue/` and `fastify-react/` are generated like the
  Express ones.
- **`selfauth add` stays Express only.** It integrates into someone else's app, and the Fastify
  adapter has not been exercised against arbitrary existing Fastify apps. `detect` and `add` say so
  and point to `init --backend fastify`.
- **Listening address.** Fastify defaults to `localhost`, which a container cannot reach, and an
  explicit `::` fails where IPv6 is missing. The generated server listens on `HOST`, default
  `0.0.0.0` (every IPv4 interface, as Express does).

## Consequences

- Two apps to keep in step; the drift test and the shared conformance suite make a divergence loud.
- A third framework repeats this recipe: an adapter, an app shell, a reference app, an adapter record
  and a smoke run. Fastify's test harness (`test/http.ts`, a small `inject` wrapper shaped like
  supertest) is reusable.
- The Vue and React browser end-to-end suite first ran against Express only. It now runs every
  frontend against both backends (`apps/e2e`), so this limitation is closed.
