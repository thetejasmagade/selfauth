<!-- Generated from docs/security-review.md by skills/scripts/sync-references.mjs. Do not edit; edit the guide. -->

# Security review

Phase 9 review of the Express reference implementation (the code `selfauth init`
and `selfauth add` generate) against specification 0.1. It records what was
checked, what it found, what was fixed, and what remains.

**This is a maintainer review, not an independent audit.** It was done by the
project with an AI coding assistant. An outside review is a condition of the
1.0 release (see [Before 1.0](#before-10)).

## Method

1. Every requirement without a conformance case has a verification entry
   (`conformance/verification.json` (in the SelfAuth repository)).
   Each one now has a **sign-off** in
   `conformance/adapters/express.json` (in the SelfAuth repository):
   the finding, and the test, source file or document that proves it. A test
   fails when a sign-off is missing or its evidence file does not exist.
2. The code-review items (13 requirements) were read against the code. The
   findings are in the sign-off table of [Conformance](conformance.md#sign-offs).
3. The generated code was searched for patterns that have no place in
   authentication code: `Math.random`, `eval`, `new Function`, `child_process`,
   `innerHTML`, and `console` calls in the auth modules. None are present.
   Tokens come from `crypto.randomBytes`, and secrets are compared with
   `timingSafeEqual`.
4. The quality gates below were added or confirmed.

## Findings and what was done

| # | Finding | Requirement | Resolution |
| --- | --- | --- | --- |
| 1 | The configuration schema allows MongoDB, which the Express adapter does not implement. A config naming it was accepted. | CONF-FILE-004 | `createAuth()` now refuses unsupported databases at startup. Test added. |
| 2 | No document said what is kept after account deletion or for how long. | IDENT-DELETE-005 | [Data retention](data-retention.md) added, checked against `deleteUser` and the schema. |
| 3 | The "no secrets in `.env.example`, `.env` is ignored" claim had no test. | SEC-SECRET-002 | A test now runs it over every generated variant. |
| 4 | Nothing enforced the "no password rotation" rule. | SEC-PWPOLICY-005 | A schema test asserts there is no age or rotation setting and rejects one. |
| 5 | Route guards were checked only by reading the examples. | AUTHZ-CORE-002 | A lint-style test fails on any example route without a guard. |
| 6 | No secret scanning in CI. | SEC-SECRET-001 | gitleaks runs over the full history. |
| 7 | The deployment guide did not say what HSTS looks like. | SEC-HTTP-002 | An example header and the production start-up check are documented. |
| 8 | Generated projects had no tests, so `validate-auth` reported `test` as skipped. | quality | Projects from `selfauth init` now ship a smoke test suite (`npm test`). |

None of the findings was an exploitable flaw in the authentication behaviour.
Findings 1 and 4 to 6 close gaps between what the specification promises and
what the build verified.

## Second review: automated hostile review (2026-11-18)

An AI agent that did not write the code was given the repository and told to
attack it (commit `0aee070`, local only, both backends, memory and PostgreSQL).
**It is still not an independent human audit**: one agent, one session, and it
says so in its own report. It found one real weakness that the first review and
the conformance suite had missed.

| # | Finding | Severity | Resolution |
| --- | --- | --- | --- |
| F1 | The per-account login limit was checked read-only before the password hash and counted only after it, so concurrent requests could all pass the check: 20 of 20 parallel guesses were evaluated against a limit of 5, on both backends and both stores (SEC-RATE-001). | Medium | The attempt is counted atomically before the hash and cleared by a verified password. The same flaw in the password-change check (not in the report, found while fixing F1) is fixed the same way. Conformance cases `CT-RATE-006` and `CT-PWCHG-004` fire ten guesses at once and require exactly the limit to be evaluated; both failed before the fix. |
| F6 | A malformed `:id` (for example `DELETE /auth/sessions/not-a-uuid`) returned 500 on the PostgreSQL store, 404 on the in-memory store. Any signed-in user could trigger it. No internals were exposed. | Low | The Prisma store treats an id that is not a UUID as not found. Conformance case `CT-SESS-006` covers it; it failed on PostgreSQL before the fix. |
| F5 | `--app-base-url` was written into `.env` unescaped, so a newline would add a line. Only the developer generating their own project could supply it. | Informational | `init` and `add` refuse spaces, control characters and non-http(s) addresses; the wizard asks again. |
| F3 | An oversized body with no `Content-Type` is `400` on Express and `413` on Fastify. Both reject it. | Informational | Left as is: no security effect. |
| F4 | `pnpm audit` lists advisories in dev and build tooling only (test utilities, ESLint, `picomatch` via `vue-router`). None ships in a generated app's runtime. | Informational | Tracked. The `picomatch` advisory is ignored on purpose in `pnpm-workspace.yaml` until a patch exists. |
| F2 | Release and CI workflows use floating action tags (`changesets/action@v1`, `gitleaks/gitleaks-action@v2`, and others). `release.yml` can publish to npm. | Low | **Open.** Pin third-party actions to full commit SHAs and keep them current with Dependabot. |

The review also attacked and found sound: account enumeration, CSRF, session
fixation and rotation, one-time token reuse under parallel requests, SQL and
header injection, mass assignment, the admin authorization surface, open
redirects, token handling in the frontends, and generator path traversal.

## Quality gates

| Gate | How |
| --- | --- |
| Unit tests | Vitest in every package (`pnpm test`). |
| Integration tests on a real database | The whole conformance suite and the store tests run on PostgreSQL 16 in CI. |
| End-to-end tests | One Playwright spec runs against the Vue and React apps. |
| Migration tests, fresh and pre-existing schemas | `apps/playground/test/postgres.test.ts` (DATA-MODEL-001, -003, -004). |
| Generated projects | `scripts/smoke-generated.sh` installs, type-checks, tests, builds, migrates and exercises each variant outside the repository. |
| Dependency scanning | `pnpm audit --prod --audit-level high` on every push; Dependabot weekly. |
| Static analysis | CodeQL (`security-extended`) on every push and pull request, and weekly. |
| Secret scanning | gitleaks over the full history, same schedule. |
| Support level | `report.test.ts` fails if a store measures below its published level ([Conformance](conformance.md)). |
| Security review | This document, plus an independent audit before 1.0. |
| Concurrency | Conformance cases fire parallel requests at one-time tokens and at the login and password-change limits. |

## Residual risks and limits

- **Self-assessed.** Sign-offs record what the project checked. They are not
  a substitute for someone else attacking the code.
- **Timing.** The conformance suite does not assert timing (CONFORMANCE.md).
  The no-account-enumeration behaviour relies on always running a hash, which
  is tested, but a timing side channel was not measured.
- **Distributed rate limiting.** The PostgreSQL store serializes rate-limit
  updates across instances (tested with two). The in-memory store is per
  process and is not for production.
- **Mailer.** Email delivery is yours. Verification and reset links are only as
  safe as the provider and the template you write.
- **Existing Prisma projects.** `selfauth add` does not merge into an existing
  Prisma schema, so database changes there are manual.

## Before 1.0

- [ ] Independent security review of the reference implementation, with
      findings published here.
- [ ] Fuzz or property tests for the request parsers and the policy engine.
- [ ] A timing test for login and registration on a quiet machine.
- [ ] Re-run this review against the final specification.
