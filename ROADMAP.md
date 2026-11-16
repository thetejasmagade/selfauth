# Roadmap and milestones

Derived from the SelfAuth development plan. Phases are ordered by dependency.

| Milestone | Phase | Status |
| --- | --- | --- |
| M0 — Product and Architecture | Phase 0 | ✅ ADRs 0001–0012, architecture, policies |
| M1 — Authentication Specification | Phase 1 | 🟡 Draft spec 0.1 + conformance cases — **needs review** |
| M2 — Monorepo Foundation | Phase 2 | ✅ pnpm + Turborepo + TS + ESLint + Prettier + Vitest + CI + Changesets |
| M3 — Express Reference Implementation | Phase 3 | ⏳ Playground skeleton only |
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

## Next: Phase 3 (after spec review)

Implement the Express reference implementation in `apps/playground` /
`packages/adapters/express`, built feature-by-feature against requirement IDs:

1. Choose Argon2 and rate-limit libraries (ADR).
2. Repository interfaces + in-memory test implementation.
3. Registration → login → session middleware → logout → logout-all.
4. Email verification, password reset, password change.
5. RBAC + `requirePermission` + resource policies.
6. Executable conformance runner mapping cases to HTTP calls.

## Decisions made after Sprint 1 review

- **Licence:** MIT; generated output and templates also 0BSD (ADR 0013).
- **Defaults:** every behavioral default is configurable within security
  bounds; `CONFIGURATION_SPEC.md` and the schema are kept in sync by a test.
- **Registration enumeration:** the more secure option — no mode reveals
  whether an email is registered, and registration never logs the user in
  (AUTHN-REG-005/009/010; `EMAIL_TAKEN` removed).

## Open items

- Create GitHub milestones and issues from this file (owner, later).
