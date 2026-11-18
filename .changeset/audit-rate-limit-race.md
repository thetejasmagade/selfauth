---
"@selfauth/cli": minor
"selfauth": minor
"@selfauth/spec": minor
"@selfauth/migration": minor
"@selfauth/conformance": minor
---

Security fixes from an automated hostile review (see `docs/security-review.md`).

- **Per-account login and password-change rate limits could be bypassed by concurrent requests.**
  The limit was read before the password hash and counted after it, so parallel guesses all passed
  the check (20 of 20 evaluated against a limit of 5). The attempt is now counted atomically before
  the hash and cleared by a verified password. Regenerate or `selfauth upgrade` to get the fix in
  `src/auth/core/service.ts`.
- On PostgreSQL, a request with a malformed `:id` (for example `DELETE /auth/sessions/not-a-uuid`)
  returned 500; it is now `404 NOT_FOUND`, as with the in-memory store (`src/auth/stores/prisma.ts`).
- `init` and `add` refuse an app base URL with spaces, control characters or a non-http(s) scheme.
- The conformance suite grows from 87 to 90 cases: `CT-RATE-006` and `CT-PWCHG-004` (concurrent
  guesses against the limits) and `CT-SESS-006` (malformed session id). The runner's `concurrent`
  step now reports `errorCodes`, so a case can count how many attempts a limit let through.
