# 0027: A Go port of the core behind a Gin adapter, held to the same conformance suite

- Status: accepted
- Date: 2026-11-18

## Context

SelfAuth generates code into a project, with no runtime dependency on SelfAuth (ADR 0002, 0021).
Express and Fastify share one TypeScript core. Gin is a Go framework: the core cannot be shared, so
supporting it means a second implementation of every rule, which is the situation the
language-neutral specification and conformance suite (ADR 0007) exist for.

## Decision

- **A full port, not a stub.** `apps/playground-gin` contains the Go core (`internal/auth`), the Gin
  binding (`internal/ginauth`) and an in-memory store. It implements the same behavior as the
  TypeScript core, including the properties that are easy to lose in a port: per-account rate
  limits counted before hashing and atomically (SEC-RATE-001), single-use tokens by conditional
  consume (AUTHN-RESET-009), password hashing on every registration path, session rotation, and
  anti-enumeration behavior.
- **The suite is the acceptance test.** The conformance runner stays in TypeScript. A Go test
  harness (`test/harness`) hosts one isolated application instance per case and exposes the
  test-only views (clock, mail, storage, events, logs) over a control API; a small TypeScript driver
  adapts it to the `Driver` contract. All 90 cases run against the Go code, and the run is a CI job.
  A deliberate defect in the login path makes ten of them fail, so the run is evidence, not a
  formality.
- **Staged delivery, no half-built authentication.** Stage 1 (this change) is the reference app
  with the memory store. Stage 2 adds a PostgreSQL store reusing the existing migration SQL. Stage 3
  adds `selfauth init --backend gin`, templates, documentation and the adapter record. Until stage 3
  nothing generates Go code, and the server refuses to run in production, so no project can ship
  authentication that has not passed the suite.
- **Layout.** `cmd/server` plus `internal/` packages: the core imports nothing from Gin, the adapter
  is the only HTTP-aware package, and the application owns `routes`, `email` and `store`. The
  configuration is a fully resolved `selfauth.config.json`, decoded strictly (unknown fields are
  errors) and validated for the bounds the Go code relies on.
- **Environment.** Go projects use `APP_ENV` instead of `NODE_ENV`.
- **Claimed level.** None yet. The adapter record (stage 3) will claim at most authorization level,
  self-assessed, like the other adapters until the production profile is independently reviewed.

## Stage 2: PostgreSQL with pgx

- **Same schema, copied.** `db/migrations` holds the Prisma-generated SQL of the TypeScript apps. A
  test requires it to stay byte-identical, so a database can move between implementations. The Go
  store speaks to those tables directly with pgx; there is no ORM.
- **Same guarantees, by the same means.** User creation is one transaction; token consumption,
  session revocation and role grants are conditional updates; rate-limit updates lock their row
  (`SELECT ... FOR UPDATE`), so several application instances share one limiter (SEC-RATE-006).
- **A small migration runner instead of Prisma.** `cmd/migrate` applies the SQL files in order, one
  transaction each, records a checksum (an applied migration that was edited afterwards is
  refused) and takes an advisory lock so two deploys cannot race. It never runs at startup. It does
  not detect destructive statements; the docs say to read every migration.
- **A contract suite for stores** (`internal/store/storetest`) runs against memory and PostgreSQL:
  atomic creation, one winner among concurrent registrations and token consumers, ids of another
  shape being "not found", exact role synchronization. It already found a difference (the memory
  store accepted an unknown role). The 90 conformance cases run against PostgreSQL as well, in
  an isolated schema per case.
- **Bounded columns.** The adapter truncates the user agent (512) and address (64) to their
  column sizes, so an oversized header cannot become a database error.

## Stage 3: generation, documentation, adapter record

- **`selfauth init --backend gin`.** The Go reference application is copied into the new project
  (registry entries like the other stacks), with one change: the module path. The reference is
  written with `example.com/app`; `go.mod` and every import of the application's own packages are
  rewritten to the project's module (`--module`, default the project name), and the module is
  recorded in the manifest so `upgrade` rewrites it the same way. A test compares every generated
  file with the reference; the generated project is built, vetted and tested (and, with PostgreSQL,
  migrated, seeded and exercised end to end) by `scripts/smoke-gin.sh` in CI.
- **API only, two databases.** (Superseded: Go projects now support every database and a Vue or React
  frontend, composed by the CLI from the same parts as the other backends.) A Go project had no generated
  frontend, and supported PostgreSQL and the in-memory store. `selfauth add` does not apply to Go. `adapter.backend` accepts `gin` in the
  configuration schema, and then `orm` must be `none`.
- **The configuration is validated in Go.** The server enforces the specification's bounds at
  start-up (strict decoding plus the schema's ranges and cross-field rules), with tests that reject
  each class, because the TypeScript schema never runs in a Go project.
- **Tests that describe defaults read a copy.** A project edits its `selfauth.config.json`; the tests
  that check secure defaults read `internal/config/testdata/default.json`, which a test keeps equal
  to the reference configuration.
- **Adapter record.** `conformance/adapters/gin.json` claims authorization level on both stores, with
  a sign-off and evidence for every requirement a case does not prove. Where the Go evidence is
  weaker than the TypeScript one, the finding says so (for example, no test fails on an unguarded
  route in application code). Production-profile status is not claimed.
- **Argon2id** is `golang.org/x/crypto/argon2`, the Go project's own maintained implementation;
  verification compares in constant time.

## Consequences

- Two implementations must now stay equal. The conformance suite is what detects drift in behavior
  it covers; behavior outside the cases (for example the logger, body parsing edge cases) is
  covered only by the Go unit tests and review.
- Differences that cannot be removed are documented in the app README (proxy trust, case folding,
  trailing slashes).
- The toolchain requirement is Go 1.26 (a dependency of Gin 1.12); CI reads it from `go.mod`.
