# Specification review checklist

The specification (`packages/spec/specs/`) is at **specVersion 0.1, draft, open for review**. It is
the source of truth for every backend: Express, Fastify, Gin and Flask each implement it and are
held to the same 90 conformance cases. This page is the checklist for the review that moves it out
of draft (roadmap milestone M1). It is written to be worked through in order, by someone who did
not write the specification.

## What is being reviewed

| File | Requirements | What it fixes in place |
| --- | --- | --- |
| [`AUTHENTICATION_SPEC.md`](../packages/spec/specs/AUTHENTICATION_SPEC.md) | 90 | Accounts, registration, login, logout, sessions, current user, email verification, password change and reset |
| [`AUTHORIZATION_SPEC.md`](../packages/spec/specs/AUTHORIZATION_SPEC.md) | 29 | Core rules, permissions, roles, resource-level checks, admin operations |
| [`SECURITY_REQUIREMENTS.md`](../packages/spec/specs/SECURITY_REQUIREMENTS.md) | 55 | Hashing, password policy, tokens, cookies, CSRF and CORS, rate limits, enumeration, secrets, audit, logging, headers, threat model |
| [`DATA_MODEL.md`](../packages/spec/specs/DATA_MODEL.md) | 5 | The entities every store must hold, and the mapping rules |
| [`ERRORS.md`](../packages/spec/specs/ERRORS.md) | 4 | The error envelope and the stable codes |
| [`CONFIGURATION_SPEC.md`](../packages/spec/specs/CONFIGURATION_SPEC.md) | 5 | The configuration schema, its bounds and the environment variables |
| [`CONFORMANCE.md`](../packages/spec/specs/CONFORMANCE.md) | – | The case format, the driver contract and the compliance levels |
| [`OPTIONAL_CAPABILITIES.md`](../packages/spec/specs/OPTIONAL_CAPABILITIES.md) | – | Informative only: OAuth, MFA, passkeys, API tokens, email change |

188 requirements in total, 161 of them mandatory. 134 are covered by conformance cases (90 cases)
and 27 by other verification (tests, code review, documentation, static analysis), each with a
sign-off. The numbers come from `pnpm --filter @selfauth/conformance coverage:report`; re-run it before you start.

## How to review

1. Read one file at a time, in the order of the sections below.
2. For every requirement ask the questions in [Each requirement](#each-requirement).
3. Record each finding in the [findings table](#findings), with the requirement ID.
4. A finding that changes behaviour needs a conformance case or a sign-off change, and the change
   has to pass on all four backends before it counts as resolved.

## Each requirement

- [ ] **Testable.** Could a test fail it? A requirement nobody can fail is a wish, not a rule.
- [ ] **Unambiguous.** Would two engineers build the same behaviour? Is the MUST / SHOULD / MAY
      the right strength, and is every SHOULD one you would accept being ignored?
- [ ] **Necessary.** Does removing it make some real attack easier or some real flow wrong?
- [ ] **Consistent.** Does it contradict another requirement, a default in the configuration
      spec, or the HTTP binding?
- [ ] **Covered.** It has a conformance case, or a verification entry and a sign-off. (CI already
      fails when it has neither; this item is about whether the case or sign-off really proves it.)
- [ ] **Language-neutral.** Does it say *what* must happen, not how one framework does it?

## Authentication

- [ ] **Identity (IDENT-ID, EMAIL, STATE, PROFILE, DELETE).** Email normalization: is simple case
      folding enough, or must Unicode be specified? (Today the Go and Python ports fold simply;
      this is a known difference.) Are the account states and the allowed transitions complete?
      Is what deletion keeps and clears (IDENT-DELETE-005, [data retention](data-retention.md))
      the right policy?
- [ ] **Registration (AUTHN-REG).** The private-by-default behaviour (never reveal an existing
      address, never sign in at registration) and the two opt-ins, `revealExistingEmail` and
      `signInAfterRegistration` (AUTHN-REG-011/012, SEC-ENUM-004). Is each trade-off stated
      honestly? Does every path cost the same hashing work (AUTHN-REG-010)?
- [ ] **Login (AUTHN-LOGIN).** Identical errors for unknown account and wrong password; the
      dummy-hash rule (AUTHN-LOGIN-003); what a suspended or unverified account sees.
- [ ] **Logout and sessions (AUTHN-LOGOUT, SESS, ME).** Idle and absolute timeouts and their
      bounds, rotation on login, revocation on password change, reset and state change, the
      touch interval, the `reauthenticatedAt` window.
- [ ] **Email verification (AUTHN-VERIFY).** Single use, expiry, resend limits, what changes when
      the address changes. Token in the URL fragment, never the query (SEC-TOKEN-005).
- [ ] **Password change and reset (AUTHN-PWCHG, RESET).** Atomic single-use consume under
      concurrency (AUTHN-RESET-009), which sessions end, what a reset does to pending tokens, what
      the response reveals about an unknown address.
- [ ] **HTTP binding (section 11, non-normative).** Is anything in it actually required? If so it
      belongs in a normative section. Are the status codes and cookie behaviour what the four
      backends really do?

## Authorization

- [ ] **Core rules (AUTHZ-CORE).** Deny by default; the subject is always derived server-side;
      authorization is checked on every request, not cached in the session.
- [ ] **Permissions and roles (AUTHZ-PERM, RBAC).** The permission name grammar, the reserved
      `auth.` prefix, the `_any` suffix convention, role synchronization and why roles that leave
      the configuration are kept (AUTHZ-RBAC-005).
- [ ] **Resource authorization (AUTHZ-RES).** Resources are loaded from storage, never from the
      request. `NOT_FOUND` versus `FORBIDDEN` for a resource you may not see (AUTHZ-RES-004, the
      `codeOneOf` case): should the spec choose one? The list-filter rule (AUTHZ-RES-006).
- [ ] **Admin operations (AUTHZ-ADMIN).** The first administrator exists only by an operator
      action (AUTHZ-ADMIN-005); the last active admin cannot be removed or disabled; self-demotion.
- [ ] **Audit (AUTHZ-AUDIT, SEC-AUDIT).** The event list is complete; events are append-only.

## Security requirements

- [ ] **Hashing (SEC-HASH).** Argon2id, the parameter floor and whether it matches current OWASP
      guidance, rehash on login when parameters rise, bounded concurrent hashing (SEC-HASH-006).
- [ ] **Password policy (SEC-PWPOLICY).** Minimum length 8, maximum length, the common-password
      list (what list, how it is versioned), no composition rules, no expiry.
- [ ] **Tokens (SEC-TOKEN).** Entropy, storage as a hash, expiry, single use.
- [ ] **Cookies (SEC-COOKIE).** `HttpOnly`, `Secure`, `SameSite`, the `__Host-` prefix, and the
      development exception that production must refuse (SEC-COOKIE-003).
- [ ] **CSRF and CORS (SEC-CSRF, CORS, REDIRECT).** Header mode and token mode, the
      `Sec-Fetch-Site` check, secret rotation, no reflected origins, no redirects at all.
- [ ] **Rate limits (SEC-RATE).** What is limited, per account and per address, the windows and
      the escalation, atomicity across instances (SEC-RATE-006), forwarded headers trusted only
      when configured (SEC-RATE-005). Is "a trusted proxy as a hop count or a list" the right
      shape, given the Go port supports only a list?
- [ ] **Enumeration (SEC-ENUM).** Every response, error and timing path that could reveal whether
      an account exists. The suite counts hashes but does not measure time: is that enough for a
      MUST?
- [ ] **Secrets, logging, transport (SEC-SECRET, LOG, HTTP).** Secrets only from the environment,
      redaction of tokens and passwords, HTTPS in production, the security headers.
- [ ] **Threat model (section 12).** Does each threat map to requirements, and does anything that
      matters appear in neither?

## Data, errors, configuration

- [ ] **Data model.** Every entity and field is needed and none is missing; uniqueness and
      cascade rules; the mapping rules work for SQL and for a document store (the MongoDB store
      embeds the credential and role links in the user document). Migrations never run at startup
      (DATA-MODEL-003) and never touch tables SelfAuth does not own (DATA-MODEL-004).
- [ ] **Errors.** The envelope is stable; every code is used and tested; no code leaks
      information; clients branch on `code`, never on the message (ERR-FORMAT-003).
- [ ] **Configuration.** Each key has a default and a security bound, and out-of-range values are
      rejected rather than clamped. Unknown keys are errors. No key can hold a secret. The schema,
      the spec and the four implementations agree (a test keeps the schema and spec in sync).

## Conformance and levels

- [ ] **The `assert` vocabulary is still open.** `CONFORMANCE.md` says it would be frozen into a
      typed schema once the first runner existed (Phase 3). Four implementations later, the
      schema still accepts any key (`conformance/src/schema.ts`). Decide the vocabulary, type it,
      and fail on an unknown assertion.
- [ ] **Case quality.** Sample cases from each file in `conformance/cases/`: does each one fail
      when the behaviour it names is broken? (Breaking the login path on purpose should fail
      several; try the same for tokens, CSRF and rate limits.)
- [ ] **Harness routes.** The `/__conformance/*` routes and the control API are test-only and
      never reachable in a generated project.
- [ ] **Levels.** Are core, authorization and production the right cut? What would production
      need that no backend has had reviewed yet (pool sizing, timeouts, failover behaviour)?
- [ ] **Concurrency cases.** Parallel one-time tokens, login and password-change limits:
      is the set complete, and are they stable on a slow machine?

## Across implementations

Three languages implement one specification. Check that the spec, not any one port, decides:

- [ ] Each known difference is either specified or accepted in writing: trusted proxies (list only
      in Go), simple case folding of addresses in Go and Python, trailing-slash handling.
- [ ] Every adapter record's limitations (`conformance/adapters/*.json`) are still true.
- [ ] No requirement is met by one backend only because of a framework default.

## Optional capabilities

- [ ] Informative only: OAuth/OIDC, account linking, MFA, passkeys, API tokens, email change.
      Confirm nothing in the normative files assumes them or blocks adding them, and that the
      "not built" status is stated wherever a reader would expect them.

## Exit criteria

The review is done when all of these hold:

- [ ] Every finding is resolved, deferred with a reason, or rejected with a reason, in the table
      below.
- [ ] Behaviour changes have conformance cases, pass on all four backends and every store, and
      `pnpm turbo run typecheck lint test` is green.
- [ ] The "draft — open for review" line is removed from each file and `specVersion` is set
      deliberately (a changeset records it).
- [ ] The roadmap row for M1 is updated, and `docs/security-review.md` "Before 1.0" is
      re-run against the final specification.
- [ ] The reviewer's name and the date are recorded under [Sign-off](#sign-off).

## Findings

| # | Requirement | Finding | Severity | Resolution | Case or sign-off |
| --- | --- | --- | --- | --- | --- |
| 1 | | | | | |

## Sign-off

- Reviewer:
- Date:
- Specification version reviewed:
- Commit:
