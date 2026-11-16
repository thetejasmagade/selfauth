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
| M7 — LLM Skills | Phase 7 | ⏳ |
| M8 — Manual Distribution | Phase 8 | ⏳ |
| M9 — Security and Conformance | Phase 9 | ⏳ |
| M10 — Additional Frameworks | Phase 10 | ⏳ |
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

## Next

1. Phase 7 — the `selfauth` agent skill (Claude Code and compatible agents),
   built on the CLI.
2. Phase 8 — publish packages and manual-integration docs.
3. Later: MongoDB + Mongoose, Prisma schema merging for `add`.

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
