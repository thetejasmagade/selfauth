# Roadmap and milestones

Derived from the SelfAuth development plan. Phases are ordered by dependency.

| Milestone | Phase | Status |
| --- | --- | --- |
| M0 — Product and Architecture | Phase 0 | ✅ ADRs 0001–0012, architecture, policies |
| M1 — Authentication Specification | Phase 1 | 🟡 Draft spec 0.1 + conformance cases — **needs review** |
| M2 — Monorepo Foundation | Phase 2 | ✅ pnpm + Turborepo + TS + ESLint + Prettier + Vitest + CI + Changesets |
| M3 — Express Reference Implementation | Phase 3 | ✅ All flows, 87/87 conformance cases (in-memory store) |
| M4 — Database and Migration Adapters | Phase 4 | ✅ PostgreSQL + Prisma (87/87), migration orchestration; MongoDB pending |
| M5 — Frontend Integrations | Phase 5 | ✅ Vue 3 and React; one browser spec passes on both |
| M6 — CLI Generator | Phase 6 | ✅ init (backend + Vue/React), add, diff/upgrade, doctor, validate, db |
| M7 — LLM Skills | Phase 7 | ✅ |
| M8 — Manual Distribution | Phase 8 | ✅ (publishing awaits npm setup) |
| M9 — Security and Conformance | Phase 9 | ✅ Levels, sign-offs, support matrix, security review, CodeQL + gitleaks, tests in generated projects |
| M10 — Additional Frameworks | Phase 10 | 🟡 Fastify and Gin (Go) done (90/90 on their stores, `init --backend fastify\|gin`); more to come |
| M11 — Stable Open-source Release | Phase 12 | ⏳ |

## Sprint 1 — Foundation

- [x] Repository initialized
- [x] License and contribution guidelines
- [x] Monorepo workspace
- [x] TypeScript, linting, formatting, and tests
- [x] Architecture and decision documents
- [x] Initial authentication specification
- [x] Authorization specification
- [x] First logical database model
- [x] First conformance test cases (+ automated coverage check)
- [x] Minimal Express sample application (`apps/playground`)

**Exit criteria:** the repository builds, tests run in CI, the core
specification is documented, and the reference application can be developed
against it.

## Phase 3 — done

- Express reference implementation in `apps/playground/src/auth` (application-owned code).
- Executable conformance runner in `@selfauth/conformance`; all 87 cases pass.
- Mutation-tested: deliberately breaking enumeration safety, CSRF, rate limits,
  session fixation, token single-use, absolute expiry, role escalation,
  deny-by-default, session revocation, or link building each fails the suite.
- ADR 0014 (`@node-rs/argon2`), ADR 0015 (own rate limiter, replacing the
  proposed `rate-limiter-flexible`, which cannot take an injected clock).

## Phase 4 — done (PostgreSQL)

- Prisma 7 schema and a committed, reviewable initial migration
  (`apps/playground/prisma`), ownership manifest `selfauth.manifest.json`.
- `PrismaAuthStore` + shared `PrismaRateLimitStore` (row-locked, atomic across instances).
- All 87 conformance cases pass on PostgreSQL as well as in memory; CI runs a Postgres service.
- `@selfauth/migration`: adapter contract, destructive/non-owned SQL detection,
  pre-existing-object conflict detection, P3005 baselining guidance; tested
  against real Prisma Migrate on fresh databases, existing Prisma projects with
  data, and conflicting tables.
- Developer commands: `db:plan`, `db:migrate`, `db:status`, `db:validate`,
  `db:seed`, `db:create-admin`, `db:rollback` (guidance).
- ADR 0016.

Deferred: MongoDB + Mongoose (after the PostgreSQL path has been used in
anger, per the MVP plan); automatic baselining of existing non-Prisma
databases (Phase 6 CLI).

## Phase 5 — done

- `apps/playground-vue` and `apps/playground-react`: app-owned framework-neutral
  client (identical copies, drift-tested), plus thin Vue (store, `useAuth()`,
  route guards, `<Can>`) and React (`AuthProvider`, `useAuth()`,
  `<RequireAuth>`, `<GuestOnly>`, `<Can>`) layers and every auth page,
  including the email-link pages (closes SEC-TOKEN-005 and SEC-REDIRECT-001
  verification).
- 47 frontend unit tests; one Playwright spec (`apps/e2e`) passes against both
  frontends with the real Express backend (separate CI job), including direct
  API calls that bypass the UI.
- `docs/frontend-deployment.md` (same origin, subdomains, cross site); ADR 0017.

## Phase 6a — done

- `@selfauth/cli`: `init` (Express + PostgreSQL/Prisma or in-memory), `list`,
  `doctor`, `validate`, `db status|plan|migrate|validate|rollback|generate`.
- Templates are the tested reference files, copied byte for byte (ADR 0018);
  apps keep spec types locally (`src/auth/types.ts`, type-tested); the
  manifest hashes every generated file to detect your edits.
- CI generates projects outside the monorepo for both databases, installs
  them from npm, migrates, boots and exercises the API.
- Found and fixed: request IDs were being redacted from logs (SEC-LOG-003).

## Phase 6b — done

- `init --frontend vue|react`: full-stack projects; the frontend in `web/` and
  the backend notes example are the browser-tested reference files.
- `selfauth add` for existing Express + TypeScript projects: new files only,
  strict preflight, printed wiring (ADR 0019).
- `selfauth diff` / `upgrade`: updates untouched files, keeps edited ones,
  writes `.selfauth-new` proposals for conflicts (ADR 0004).
- CI smoke-tests five combinations outside the monorepo, including `add` on a
  separate existing app.

## Phase 7 — done

- `skills/selfauth`: `SKILL.md` covers the plan's ten responsibilities and
  its safety rules. Also `references/` (spec copies kept in sync by a test,
  plus architecture, framework support and migration rules),
  `scripts/detect-project.ts`, `scripts/validate-auth.ts`, and examples
  (ADR 0020).
- CLI: `selfauth detect --json` (stack, database, existing auth in packages
  *and* source, recommendation, blockers), `--json` for
  `list`/`doctor`/`validate`, and `selfauth skill install --agent
  claude|codex|cursor|all`.
- `integrations/`: Claude Code, Codex, Cursor and other agents.
- `examples/existing-express-app`: the sample project for acceptance. CI adds
  SelfAuth to it via the skill's scripts, applies the agent's integration
  patch, and runs its own tests. Every generated-project job also has to
  print `validate-auth` `RESULT: PASS`.

## Phase 8 — done (publishing awaits the maintainer's npm setup)

- Publish-ready packages: `@selfauth/cli`, `selfauth` (the `npx selfauth`
  alias), `@selfauth/spec`, `@selfauth/migration` and
  `@selfauth/conformance`. Each has metadata, a README, a LICENSE and
  provenance. `scripts/pack-check.sh` installs the tarballs outside the repo,
  and CI runs the smoke tests with the packaged CLI. A changeset for 0.1.0
  and `release.yml` are in place (docs/releasing.md).
- `templates/`: four standalone projects generated from the CLI, with a CI
  drift check. A CI job runs `templates/express` with no SelfAuth tooling at
  all.
- Docs: manual integration; API reference (HTTP, server, client), checked
  against the code; database schema and migrations; customization;
  upgrading; releasing.
- Tested: no generated variant depends on, imports or contacts anything
  from SelfAuth (ADR 0021).

## Phase 9 — done

- Compliance levels computed from case results and sign-offs (`evaluateLevels`, ADR 0022).
  Express: PostgreSQL store published at production-profile (self-assessed), in-memory at
  authorization.
- Every non-case requirement has a sign-off with evidence; CI fails on a missing one.
- Generated [support matrix](docs/conformance.md): versions, known limitations, coverage by area.
- [Security review](docs/security-review.md): 8 findings, all closed; independent audit is a 1.0 gate.
- CI: CodeQL and gitleaks (`.github/workflows/security.yml`).
- `selfauth init` projects ship a smoke test suite (`npm test`), so `validate-auth` runs tests.

## Phase 10 — Fastify done

- `apps/playground-fastify`: the same core and stores behind a Fastify adapter. All 87
  conformance cases pass with the memory store and with PostgreSQL; the PostgreSQL migration,
  auth, app and docs tests are ported.
- `selfauth init --backend fastify` (API only, or full-stack with Vue or React); templates
  `fastify/`, `fastify-vue/`, `fastify-react/`; CI smoke-tests generated Fastify projects.
- `conformance/adapters/fastify.json` and the generated [`docs/conformance-fastify.md`](docs/conformance-fastify.md):
  authorization level on both stores; production-profile is not claimed yet.
- `selfauth add` for existing Fastify projects (Fastify `setup.ts`, `examples/existing-fastify-app`), and the browser end-to-end suite runs every frontend against both backends.
- ADR 0024.

## Phase 10 — Gin (Go) done

- `apps/playground-gin`: a Go port of the core (`internal/auth`) behind a Gin adapter, with an
  in-memory store and a PostgreSQL store (pgx, the same migration SQL as the TypeScript apps, a
  small migration runner). All 90 conformance cases pass on both stores; a Go test harness hosts
  one isolated instance per case and a TypeScript driver runs the shared suite against it.
- `selfauth init --backend gin` (any database; with Vue or React as `server/` + `client/`, browser-tested against the Go server); template `gin/`; CI smoke-tests
  generated Gin projects. `selfauth doctor`, `validate`, `diff`, `upgrade` and `db` work on them.
  `selfauth add` does not apply to Go.
- `conformance/adapters/gin.json` and the generated [`docs/conformance-gin.md`](docs/conformance-gin.md):
  authorization level on both stores; production-profile is not claimed.
- ADR 0027.

## Phase 10 — Flask (Python) done

- `apps/playground-flask`: a Python port of the core (`app/auth`) behind a Flask adapter, with the
  memory, PostgreSQL (psycopg), MySQL (PyMySQL), SQLite (`sqlite3`) and MongoDB (PyMongo) stores, the
  same migration SQL as the other apps and a small migration runner. All 90 conformance cases run on
  every store; a Python harness hosts one isolated instance per case.
- `selfauth init --backend flask` (any database; with Vue or React as `server/` + `client/`,
  browser-tested against the Flask server). `selfauth doctor`, `validate`, `diff`, `upgrade` and `db`
  work on them. `selfauth add` does not apply to Python.
- `conformance/adapters/flask.json` and the generated [`docs/conformance-flask.md`](docs/conformance-flask.md):
  authorization level on every store; production-profile is not claimed.
- ADR 0028.

## Next

1. Maintainer: independent security review before 1.0 (docs/security-review.md, "Before 1.0").
2. Phase 10, continued: more frameworks and languages (NestJS, Next.js, ...). Each adds its own adapter record and sign-offs. For Fastify and Gin: a production-profile review. For Gin: MySQL/SQLite/MongoDB stores and a frontend.
3. Later: MongoDB + Mongoose, Prisma schema merging for `add`, tests for the `add` layout.

## Decisions made after Sprint 1 review

- **Licence:** MIT; generated output and templates also 0BSD (ADR 0013).
- **Defaults:** every behavioral default is configurable within security
  bounds; `CONFIGURATION_SPEC.md` and the schema are kept in sync by a test.
- **Registration enumeration:** private by default — registration never
  reveals whether an email is registered and never logs the user in
  (AUTHN-REG-005/009/010). Projects may opt in to `revealExistingEmail` and
  `signInAfterRegistration` as a documented trade-off (AUTHN-REG-011/012,
  SEC-ENUM-004).

## Open items

- Create GitHub milestones and issues from this file (owner, later).
