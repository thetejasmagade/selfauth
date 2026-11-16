# Security requirements

- **specVersion:** 0.1 (draft — open for review)
- **Related:** [AUTHENTICATION_SPEC](AUTHENTICATION_SPEC.md) ·
  [AUTHORIZATION_SPEC](AUTHORIZATION_SPEC.md) ·
  [CONFIGURATION_SPEC](CONFIGURATION_SPEC.md)

Cross-cutting rules every adapter must meet. Implementations MUST use
established, maintained libraries for every cryptographic primitive; SelfAuth
never defines custom cryptography.

## 1. Password hashing

- **[SEC-HASH-001]** (MUST) Passwords MUST be hashed with Argon2id using a
  maintained library. Where an adapter's platform has no maintained Argon2id
  implementation, the fallback (scrypt, then bcrypt) MUST be recorded in an ADR.
- **[SEC-HASH-002]** (MUST) Argon2id parameters MUST be at least
  m = 19 MiB, t = 2, p = 1 (or m = 46 MiB, t = 1, p = 1), with a random salt of
  ≥ 16 bytes generated per hash by the library. Parameters are configurable
  (`authentication.password.hashing`) but MUST NOT be configurable below these
  floors.
- **[SEC-HASH-003]** (MUST) Hashes MUST be stored in a self-describing format
  (PHC string) that records algorithm and parameters.
- **[SEC-HASH-004]** (SHOULD) Hashes with parameters below the current
  configuration SHOULD be upgraded on the next successful verification.
- **[SEC-HASH-005]** (MUST) Before hashing or verifying, passwords MUST be
  normalized with Unicode NFKC and MUST NOT be otherwise altered (no trimming,
  no case folding, no silent truncation). This keeps hashes portable between
  adapters in different languages.
- **[SEC-HASH-006]** (MUST) Hashing MUST NOT block the server's request-handling
  thread/event loop for other requests (use the library's asynchronous or
  worker-based API where the platform requires it).
- **[SEC-HASH-007]** (MUST NOT) Passwords MUST NOT be stored, logged, cached,
  or transmitted anywhere in recoverable form, including reversible encryption.

## 2. Password policy

- **[SEC-PWPOLICY-001]** (MUST) Passwords MUST have a minimum length, configurable,
  default **12** characters, and the configuration MUST reject values below 8.
  (NIST SP 800-63B-4 recommends 15 for passwords used as a single factor;
  projects may raise the default.)
- **[SEC-PWPOLICY-002]** (MUST) A maximum length MUST be enforced before hashing
  (default 128 characters; never below 64) to bound hashing cost; over-long
  passwords fail with `PASSWORD_POLICY_VIOLATION`, never by truncation.
- **[SEC-PWPOLICY-003]** (MUST) All Unicode characters, including spaces, MUST be
  accepted. Composition rules (e.g. "one digit, one symbol") MUST NOT be
  required.
- **[SEC-PWPOLICY-004]** (SHOULD) Passwords SHOULD be checked against a list of
  common/breached passwords bundled with the application (offline by default).
  Online breach-check services MAY be offered only as opt-in configuration
  (ADR 0002).
- **[SEC-PWPOLICY-005]** (MUST NOT) Periodic forced password rotation MUST NOT
  be required by default.
- **[SEC-PWPOLICY-006]** (SHOULD) A password equal to the user's email address
  (case-insensitively) SHOULD be rejected.

## 3. Random values and one-time tokens

- **[SEC-TOKEN-001]** (MUST) Session tokens, password-reset tokens, and
  email-verification tokens MUST contain at least 256 bits of entropy from the
  platform's cryptographically secure random number generator, encoded as
  base64url (or hex).
- **[SEC-TOKEN-002]** (MUST) Only a SHA-256 (or stronger) hash of each token MUST
  be stored. Tokens MUST be looked up by hash; raw tokens MUST NOT be persisted.
- **[SEC-TOKEN-003]** (MUST) One-time tokens MUST be single-use, have a bounded
  expiry, be bound to one user and one purpose (a reset token is never accepted
  as a verification token or vice versa), and be consumed atomically.
- **[SEC-TOKEN-004]** (MUST) All token failures (unknown, expired, used, wrong
  purpose, user no longer eligible) MUST produce the single error code
  `TOKEN_INVALID`.
- **[SEC-TOKEN-005]** (MUST) Pages that receive tokens via links MUST send
  `Referrer-Policy: no-referrer`; email links SHOULD carry tokens in the URL
  fragment and the page SHOULD submit them with `POST`.

## 4. Cookies

- **[SEC-COOKIE-001]** (MUST) The session cookie MUST be `HttpOnly`, `Secure`,
  `Path=/`, and `SameSite=Lax` or `Strict` (default `Lax`). It MUST NOT be
  readable by client-side script.
- **[SEC-COOKIE-002]** (MUST) In production the cookie name MUST default to
  `__Host-session` (which forbids a `Domain` attribute). A `Domain` attribute
  MUST NOT be set unless explicitly configured.
- **[SEC-COOKIE-003]** (MUST) `Secure` MAY be disabled only for development on
  `http://localhost`, only by explicit configuration, and MUST cause a startup
  error if the environment is production.
- **[SEC-COOKIE-004]** (MUST) The cookie expiry (`Max-Age`/`Expires`) MUST NOT
  exceed the session's absolute expiry.
- **[SEC-COOKIE-005]** (MUST) Cross-site deployments that require
  `SameSite=None` MUST be an explicit configuration choice and MUST still meet
  §5 (token-based CSRF protection becomes mandatory).

## 5. CSRF and cross-origin requests

- **[SEC-CSRF-001]** (MUST) Every state-changing operation authenticated by
  cookie — and the login and registration operations — MUST be CSRF-protected.
- **[SEC-CSRF-002]** (MUST) Safe methods (HTTP `GET`, `HEAD`, `OPTIONS`) MUST NOT
  change state.
- **[SEC-CSRF-003]** (MUST) For unsafe methods, the server MUST verify the
  request origin: reject if `Sec-Fetch-Site` is `cross-site`, or if `Origin`
  is present and not in the configured trusted-origins list. If neither
  `Origin` nor `Sec-Fetch-Site` is present, the request MUST be rejected unless
  it carries a valid CSRF token (§5 SEC-CSRF-004).
- **[SEC-CSRF-004]** (MUST) In addition to origin verification, unsafe requests
  MUST present either (a) a CSRF token bound to the session (synchronizer or
  signed double-submit token), or (b) a required custom request header (default
  `X-SelfAuth-CSRF: 1`) with a CORS policy that never allows untrusted origins.
  Option (a) is mandatory when `SameSite=None` is configured.
- **[SEC-CSRF-005]** (MUST) CSRF failures MUST return `CSRF_FAILED` and record a
  `csrf.rejected` event (rate limited).
- **[SEC-CORS-001]** (MUST NOT) The server MUST NOT reflect arbitrary `Origin`
  values in `Access-Control-Allow-Origin` together with
  `Access-Control-Allow-Credentials: true`; allowed origins come from explicit
  configuration only.
- **[SEC-REDIRECT-001]** (MUST) Any post-login or post-action redirect target
  accepted from the client MUST be validated as a same-origin relative path
  (open-redirect protection).

## 6. Rate limiting and brute-force protection

- **[SEC-RATE-001]** (MUST) Login and password-change attempts MUST be limited
  per normalized email (or user) and per client address. Defaults: 5 failed
  attempts per account per 15 minutes, 100 attempts per address per 15
  minutes, with exponential back-off.
- **[SEC-RATE-002]** (MUST) Registration, password-reset requests, and
  verification resends MUST be limited per normalized email and per client
  address.
- **[SEC-RATE-003]** (MUST NOT) Rate limiting MUST NOT permanently lock accounts
  automatically; blocks are temporary.
- **[SEC-RATE-004]** (MUST) Rate-limited requests MUST fail with `RATE_LIMITED`
  and SHOULD include a retry-after hint. The rate-limited response MUST be the
  same whether or not the account exists.
- **[SEC-RATE-005]** (MUST) The client address MUST be derived from the
  connection unless trusted proxies are explicitly configured; forwarding
  headers (`X-Forwarded-For`, `Forwarded`) MUST NOT be trusted by default.
- **[SEC-RATE-006]** (SHOULD) Production deployments with more than one
  application instance SHOULD use a shared rate-limit store; adapters MUST
  document when their default store is per-process.

## 7. Account enumeration

- **[SEC-ENUM-001]** (MUST) Login, password-reset request, verification resend,
  and registration (in every verification mode) MUST return responses that are
  indistinguishable (status code, body, headers other than request IDs)
  whether or not an account exists.
- **[SEC-ENUM-002]** (MUST) (WITHDRAWN) No configuration permits account
  enumeration any more (see [AUTHN-REG-009]).
- **[SEC-ENUM-003]** (SHOULD) Response timing SHOULD NOT reveal account
  existence; in particular work such as sending email SHOULD be done in a way
  that does not lengthen only the "account exists" path (e.g. queued).

## 8. Secrets and environment configuration

- **[SEC-SECRET-001]** (MUST NOT) Secrets (database credentials, email provider
  keys, CSRF signing keys) MUST NOT appear in the SelfAuth configuration file,
  generated source code, or committed files. They are read from the
  environment.
- **[SEC-SECRET-002]** (MUST) Generators MUST create `.env.example` with
  placeholder values only, and MUST ensure `.env` is git-ignored.
- **[SEC-SECRET-003]** (MUST) Required configuration (including the application
  base URL and any signing key) MUST be validated at startup; the application
  MUST refuse to start if it is missing or invalid.
- **[SEC-SECRET-004]** (MUST) Signing keys, when used, MUST be ≥ 256 bits of
  random data and SHOULD support rotation (accept previous key while issuing
  with the current one).

## 9. Security events (audit)

- **[SEC-AUDIT-001]** (MUST) Implementations MUST record at least these events:
  `user.registered`, `auth.login.succeeded`, `auth.login.failed`,
  `auth.logout`, `auth.sessions.revoked_all`, `password.changed`,
  `password.reset.requested`, `password.reset.completed`, `email.verified`,
  `account.state_changed`, `role.assigned`, `role.removed`,
  `role.permissions_changed`, `rate_limit.triggered`, `csrf.rejected`.
- **[SEC-AUDIT-002]** (MUST) Each event MUST record: type, timestamp, outcome,
  user ID (if known), actor ID (if different), client address, user agent, and
  request ID where available, plus event-specific metadata.
- **[SEC-AUDIT-003]** (MUST NOT) Event metadata MUST NOT contain passwords,
  password hashes, session tokens, one-time tokens, or their hashes.
- **[SEC-AUDIT-004]** (MUST) The generated code MUST NOT expose an operation that
  updates or deletes individual security events; retention/purging is a
  separate, application-controlled job.
- **[SEC-AUDIT-005]** (SHOULD) Security events SHOULD be written through a sink
  interface so applications can forward them to their own logging/SIEM.

## 10. Logging and error output

- **[SEC-LOG-001]** (MUST) Application logs MUST redact: request fields named
  `password`, `currentPassword`, `newPassword`, `token`; `Cookie`,
  `Set-Cookie`, and `Authorization` headers; and any value matching a session
  or one-time token.
- **[SEC-LOG-002]** (MUST NOT) Error responses in production MUST NOT include
  stack traces, SQL, internal identifiers of other users, or library error
  messages.
- **[SEC-LOG-003]** (SHOULD) Every response SHOULD carry a request ID that also
  appears in logs and security events, to correlate incidents.

## 11. Transport and headers

- **[SEC-HTTP-001]** (MUST) Authentication responses MUST include
  `Cache-Control: no-store`.
- **[SEC-HTTP-002]** (MUST) Production deployments MUST serve authentication over
  HTTPS; adapters SHOULD document HSTS.
- **[SEC-HTTP-003]** (MUST) Request body size for authentication operations MUST
  be bounded (`http.bodyLimitBytes`, default 16 KiB).

## 12. Threat model (summary)

Assets: credentials, session tokens, one-time tokens, account state, role
assignments, security events, personal data (email).

Actors: anonymous internet attacker; authenticated low-privilege user;
attacker with read access to a database backup; malicious site visited by a
user (CSRF); attacker who can inject script into the app (XSS).

| Threat / abuse case | Mitigation (requirements) |
| --- | --- |
| Credential stuffing, password guessing | SEC-RATE-001, SEC-RATE-003, SEC-PWPOLICY-004, AUTHN-LOGIN-006 |
| Account enumeration (login, reset, register, timing) | SEC-ENUM-001, SEC-ENUM-003, AUTHN-LOGIN-002/003, AUTHN-REG-005/009/010 |
| Database leak → offline cracking / token reuse | SEC-HASH-001…003, SEC-TOKEN-002, AUTHN-SESS-002 |
| Session fixation | AUTHN-LOGIN-005 |
| Session theft via XSS | SEC-COOKIE-001 (HttpOnly); XSS prevention itself is application-owned |
| Stolen session after password change/reset | AUTHN-PWCHG-003, AUTHN-RESET-010, AUTHN-SESS-006 |
| CSRF, login CSRF | SEC-CSRF-001…005, SEC-CORS-001, SEC-COOKIE-001 |
| Reset/verify token replay or race | SEC-TOKEN-003, AUTHN-RESET-009, AUTHN-VERIFY-006 |
| Token leakage via Referer / logs | SEC-TOKEN-005, SEC-LOG-001 |
| Host-header poisoning of reset links | AUTHN-VERIFY-009, AUTHN-RESET-006 |
| Mass assignment of role/state at registration | AUTHN-REG-002, AUTHZ-ADMIN-005 |
| Privilege escalation via role delegation | AUTHZ-ADMIN-002, AUTHZ-ADMIN-003 |
| IDOR / horizontal access | AUTHZ-RES-001…006 |
| Trusting frontend role checks | AUTHZ-CORE-003, AUTHZ-CORE-004 |
| DoS via long passwords / large bodies | SEC-PWPOLICY-002, SEC-HTTP-003, SEC-HASH-006 |
| Spoofed client IP evading rate limits | SEC-RATE-005 |
| Lockout of victims by attackers | SEC-RATE-003 |
| Open redirect after login | SEC-REDIRECT-001 |
| Secrets committed to repository | SEC-SECRET-001, SEC-SECRET-002 |
| Repudiation of admin actions | AUTHZ-ADMIN-001, SEC-AUDIT-001…004 |

Out of scope for this spec: XSS and injection prevention in application code,
infrastructure hardening, email deliverability, and phishing — the adapters
document recommended practices.
