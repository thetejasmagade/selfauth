# Roadmap and milestones

Derived from the SelfAuth development plan. Phases are ordered by dependency.

| Milestone | Phase | Status |
| --- | --- | --- |
| M0 — Product and Architecture | Phase 0 | ✅ ADRs 0001–0012, architecture, policies |
| M1 — Authentication Specification | Phase 1 | 🟡 Draft spec 0.1 + conformance cases — **needs review** |
| M2 — Monorepo Foundation | Phase 2 | ✅ pnpm + Turborepo + TS + ESLint + Prettier + Vitest + CI + Changesets |
| M3 — Express Reference Implementation | Phase 3 | ✅ All flows, 87/87 conformance cases (in-memory store) |
| M4 — Database and Migration Adapters | Phase 4 | ⏳ |
| M5 — Frontend Integrations | Phase 5 | ⏳ |
| M6 — CLI Generator | Phase 6 | ⏳ |
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

## Next: Phase 4 — database adapters and migrations

1. Prisma schema for the logical model + generated native migrations.
2. `PrismaAuthStore` implementing `AuthStore`; atomic consume via conditional updates.
3. Run the same 87 cases against PostgreSQL (CI service container).
4. Shared rate-limit store (database table) for multi-instance deployments.
5. Migration safety: manifest, existing-schema detection, no startup migrations.

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
