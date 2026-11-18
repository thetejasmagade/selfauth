# SelfAuth reference application for Gin (Go)

Email/password authentication and role-based authorization for a [Gin](https://gin-gonic.com)
application, ported from the TypeScript reference implementation and held to the **same
language-neutral conformance suite** (`conformance/cases/*.json`, 90 cases).

> **Status: in development (stage 2 of 3).** The core, the Gin adapter, an in-memory store and a
> PostgreSQL store pass every conformance case. `selfauth init --backend gin` does not exist yet, and
> nothing here is a claim of production readiness.

## Layout

```
cmd/server/main.go            entry point: reads the environment and selfauth.config.json, starts Gin
cmd/migrate, cmd/seed,        database commands: apply migrations, synchronize roles, grant the first admin
  cmd/create-admin
db/migrations/                the PostgreSQL schema (byte-identical to the TypeScript reference apps)
internal/
  auth/                       the authentication core: no HTTP, no Gin
    service.go                register, login, sessions, verification, reset, admin (the business rules)
    password.go               Argon2id (PHC strings), policy, dummy verification for timing
    ratelimit.go              fixed window with exponential back-off, atomic per key
    authz.go                  roles, permissions, resource policies
    store.go                  the persistence contract (the only interface a database must implement)
    mailer.go, logger.go, ... mail delivery, redacting logger, clock, crypto, errors
  ginauth/                    the Gin binding: cookies, CORS, session lookup, CSRF, /auth routes, guards
  httpx/                      request IDs, error envelope, JSON body limit, recovery, request log
  store/                      picks the backend (DATABASE_URL set: PostgreSQL, else memory in development)
    memory/                   in-memory store (development and tests)
    postgres/                 pgx store, rate-limit store and the small migration runner
    storetest/                the behavior every store must have, run against each implementation
  email/mailer.go             YOUR email provider goes here (production refuses to start without one)
  routes/routes.go            YOUR application routes go here
  config/                     selfauth.config.json and the environment
  app/                        wiring: NewAuth and NewRouter
selfauth.config.json          resolved SelfAuth configuration (behavior only, never secrets)
test/harness/                 test-only server the conformance suite drives (not part of the app)
test/conformance/             TypeScript driver for the shared conformance suite
```

`internal/auth` imports nothing from Gin. The adapter is the only place that knows about HTTP, so
the core can be read, tested and audited on its own.

## Run

```bash
cd apps/playground-gin
SELFAUTH_APP_BASE_URL=http://localhost:5173 go run ./cmd/server
```

Without `DATABASE_URL` the development server uses the in-memory store and prints verification and
reset links to the console. With PostgreSQL:

```bash
export DATABASE_URL=postgres://selfauth:selfauth@localhost:5432/selfauth_dev
go run ./cmd/migrate status     # what is applied and pending
go run ./cmd/migrate up         # apply pending migrations (read them first; take a backup in production)
go run ./cmd/seed               # synchronize roles and permissions from selfauth.config.json
go run ./cmd/create-admin you@example.com   # after that account registered and verified
go run ./cmd/server
```

Nothing migrates or seeds at startup (DATA-MODEL-003, AUTHZ-RBAC-005); the server refuses to start
when a default role is missing. Production requires `DATABASE_URL`. Configuration is read from the process environment (see `.env.example`):

| Variable                        | Meaning                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `APP_ENV`                       | `development` (default), `test` or `production`                      |
| `PORT`                          | listen port, default `3000`                                          |
| `SELFAUTH_APP_BASE_URL`         | required; the base of email links (https in production)              |
| `DATABASE_URL`                  | PostgreSQL connection string; required in production                 |
| `SELFAUTH_CSRF_SECRET`          | 32+ random bytes, base64url; required when `http.csrf.mode` is token |
| `SELFAUTH_CSRF_SECRET_PREVIOUS` | accepted during rotation                                             |
| `SELFAUTH_CONFIG`               | path of the configuration file, default `selfauth.config.json`       |

## Protect your own routes

```go
api := a.ProtectedRoutes(r.Group("/api"))
api.GET("/reports", a.RequirePermission("reports.view"), listReports)
```

Routes registered through `ProtectedRoutes` are denied unless a guard explicitly allows them
(AUTHZ-CORE-001). An undefined permission panics when the route is defined (AUTHZ-PERM-004).
Declare permissions and roles in `selfauth.config.json`.

## Test

```bash
go vet ./... && go test -race ./...        # unit and adapter tests
pnpm --filter @selfauth/playground-gin conformance   # the 90 shared conformance cases, per store
```

The PostgreSQL tests and conformance run need `TEST_DATABASE_URL` (a user that may create schemas;
each test gets its own schema). Without it they skip locally; with `SELFAUTH_REQUIRE_POSTGRES=1`,
as in CI, a missing database is a failure instead.

The conformance runner is TypeScript and drives an application over HTTP. `test/harness` hosts one
isolated instance per case (own store, clock, mailer, logs) and exposes the test-only views a case
needs: time, the last email, storage, security events and logs.

## Differences from the TypeScript implementations

These are deliberate and none weakens a requirement:

- **Trusted proxies.** `http.trustProxy` accepts `false` (default: forwarding headers are ignored) or
  a list of proxy addresses or CIDRs. A hop count is not supported, because Gin trusts addresses, not
  hops.
- **Case folding.** Email normalization lower-cases with Go's simple case mapping; JavaScript uses
  the full mapping. A few exotic characters (for example U+0130) normalize differently, so an
  address registered through one implementation could be a different account in the other.
- **Trailing slashes** are not matched (`/auth/login/` is a 404), and an encoded `/` in an ID never
  changes which route matches.
- **Cancelled requests.** A state-changing operation that has started runs to completion even if the
  client disconnects, so a one-time token is never consumed without its effect being applied.
- **Migrations.** `cmd/migrate` is a small runner (SQL files in name order, one transaction each,
  checksums recorded in `selfauth_migrations`, an advisory lock against concurrent runs). It does not
  analyze migrations for destructive changes the way `selfauth db plan` does for Prisma projects, so
  read every new migration before applying it.
- **Hash concurrency.** Concurrent Argon2 computations are bounded (2 × `GOMAXPROCS`), so a burst of
  logins queues instead of exhausting memory.
