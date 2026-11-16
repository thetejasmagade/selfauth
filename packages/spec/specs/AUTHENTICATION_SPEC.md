# Authentication specification

- **specVersion:** 0.1 (draft — open for review)
- **Normative language:** RFC 2119 / RFC 8174. Requirement format: ADR 0007.
- **Related:** [AUTHORIZATION_SPEC](AUTHORIZATION_SPEC.md) ·
  [SECURITY_REQUIREMENTS](SECURITY_REQUIREMENTS.md) · [DATA_MODEL](DATA_MODEL.md) ·
  [ERRORS](ERRORS.md) · [CONFIGURATION_SPEC](CONFIGURATION_SPEC.md) ·
  [CONFORMANCE](CONFORMANCE.md)

This document defines **what** a compliant implementation does, in terms of
abstract *operations*, *inputs*, *outcomes* and *error codes*. It does not
depend on any framework, ORM, or database. Section 11 gives a non-normative
HTTP binding that the MVP adapters follow.

## 1. Terms

| Term | Meaning |
| --- | --- |
| **User** | An account record identified by a user ID. |
| **Credential** | Secret material proving identity (MVP: a password hash). Stored separately from the user. |
| **Session** | Server-side record of an authenticated browser session, referenced by an opaque session token. |
| **Session token** | High-entropy random value held by the client (cookie). Only its hash is stored. |
| **One-time token** | High-entropy random value for password reset or email verification. Only its hash is stored. |
| **Normalized email** | The email form used for uniqueness and lookup (§2.2). |
| **Subject** | The authenticated user making a request. |

## 2. Identity and accounts

### 2.1 User identifiers

- **[IDENT-ID-001]** (MUST) Every user MUST have an immutable identifier
  assigned by the server at creation.
- **[IDENT-ID-002]** (MUST) User identifiers exposed outside the server MUST NOT
  be sequential or otherwise enumerable. UUIDv4, UUIDv7, or ≥ 128-bit random
  identifiers satisfy this.
- **[IDENT-ID-003]** (MUST NOT) A user identifier MUST NOT be reassigned to a
  different account, including after deletion.

### 2.2 Email normalization and uniqueness

- **[IDENT-EMAIL-001]** (MUST) Before lookup or uniqueness comparison, an email
  address MUST be normalized by: trimming leading/trailing whitespace, applying
  Unicode NFC, and lower-casing the entire address.
- **[IDENT-EMAIL-002]** (MUST NOT) Normalization MUST NOT apply provider-specific
  rules (removing dots, removing `+tag` suffixes, mapping domains).
- **[IDENT-EMAIL-003]** (MUST) The normalized email MUST be unique among users
  that are not in the `deleted` state, enforced by the database (unique
  constraint or index), not only by application code.
- **[IDENT-EMAIL-004]** (MUST) Email input MUST be rejected with
  `VALIDATION_FAILED` if it is longer than 254 characters, has no `@`, has an
  empty local part or domain, or contains whitespace or control characters
  after trimming.
- **[IDENT-EMAIL-005]** (SHOULD) The address as entered (after trimming) SHOULD
  be stored for display and correspondence alongside the normalized form.

### 2.3 Account states

| State | Meaning | Can log in |
| --- | --- | --- |
| `pending` | Registered; email verification required and not yet completed | No (`EMAIL_NOT_VERIFIED`) |
| `active` | Normal account | Yes |
| `suspended` | Temporarily blocked by an administrator | No (`ACCOUNT_UNAVAILABLE`) |
| `disabled` | Deactivated by the user or an administrator | No (`ACCOUNT_UNAVAILABLE`) |
| `deleted` | Terminal; treated as non-existent | No (`INVALID_CREDENTIALS`) |

Allowed transitions:

```text
pending ──verify email──► active
active ◄──admin──► suspended
pending | active | suspended ──user or admin──► disabled ──admin──► active
any state ──delete──► deleted   (terminal)
```

- **[IDENT-STATE-001]** (MUST) Every user MUST be in exactly one of the states
  `pending`, `active`, `suspended`, `disabled`, `deleted`.
- **[IDENT-STATE-002]** (MUST NOT) Transitions not listed above MUST NOT be
  possible; in particular `deleted` is terminal.
- **[IDENT-STATE-003]** (MUST) When a user enters `suspended`, `disabled` or
  `deleted`, all of the user's sessions and outstanding one-time tokens MUST be
  revoked in the same operation.
- **[IDENT-STATE-004]** (MUST) Session validation MUST reject sessions whose
  user is not `active` (defense in depth, independent of
  [IDENT-STATE-003]).
- **[IDENT-STATE-005]** (MUST) Every state change MUST record a security event
  including the actor, previous state, and new state.

### 2.4 Profile and credentials

- **[IDENT-PROFILE-001]** (MUST) Credentials (password hashes) MUST be stored in
  a separate logical entity from the user/profile record (see
  [DATA_MODEL](DATA_MODEL.md)).
- **[IDENT-PROFILE-002]** (MUST NOT) Operation responses MUST NOT include
  password hashes, session tokens or their hashes, or one-time tokens or their
  hashes. (Exception: the session token in the `Set-Cookie` header of the
  operation that creates the session.)
- **[IDENT-PROFILE-003]** (MAY) Applications MAY attach additional profile
  fields; these are application-owned and outside this specification.

### 2.5 Account deletion and retention

- **[IDENT-DELETE-001]** (MUST) Deleting an account MUST: set state `deleted`,
  revoke all sessions and one-time tokens, and delete the account's
  credentials.
- **[IDENT-DELETE-002]** (MUST) After deletion the normalized email MUST be
  released for re-registration (e.g. by clearing it on the tombstone), and the
  stored email SHOULD be removed or irreversibly pseudonymized.
- **[IDENT-DELETE-003]** (MUST) User-initiated deletion MUST require
  re-authentication with the current password.
- **[IDENT-DELETE-004]** (SHOULD) Security events MAY be retained after deletion
  for the application's configured retention period, but SHOULD NOT retain the
  email address in clear text.
- **[IDENT-DELETE-005]** (MUST) Adapters MUST document what data is retained
  after deletion and for how long, so the application owner can meet their own
  legal obligations.

## 3. Registration — `register(email, password)`

Behavior depends on `emailVerification.mode` ([CONFIGURATION_SPEC](CONFIGURATION_SPEC.md)):
`required` (default), `optional`, or `off`. In **every** mode, registration
never reveals whether an email already has an account: the outcome is always
`accepted`, and registration never creates a session — the user logs in
afterwards. (Creating a session for new emails only would reveal which emails
already exist.)

- **[AUTHN-REG-001]** (MUST) Registration MUST validate the email
  ([IDENT-EMAIL-004]) and password policy ([SEC-PWPOLICY-001] …) before creating
  any record, returning `VALIDATION_FAILED` or `PASSWORD_POLICY_VIOLATION`.
- **[AUTHN-REG-002]** (MUST) Registration MUST ignore or reject any
  client-supplied value for state, roles, permissions, email-verified flag, or
  user ID (mass-assignment protection). New users receive only the configured
  default role(s).
- **[AUTHN-REG-003]** (MUST) Registration MUST create the user and credential
  atomically: either both exist afterwards or neither does.
- **[AUTHN-REG-004]** (MUST) In `required` mode, the new user MUST be created in
  state `pending`, a verification email MUST be sent (§8), and no session MUST
  be created. The outcome is `accepted`.
- **[AUTHN-REG-005]** (MUST) In every verification mode, registering an email
  that already belongs to a non-deleted user MUST produce an outcome indistinguishable
  from a new registration (same status, same body, no session), and MUST NOT
  modify the existing account. The implementation SHOULD send the existing
  owner a notification email instead.
- **[AUTHN-REG-006]** (MUST) (WITHDRAWN) Replaced by [AUTHN-REG-009]; the
  `EMAIL_TAKEN` error and the optional immediate session were removed so that
  no mode allows account enumeration.
- **[AUTHN-REG-007]** (MUST) Concurrent registrations for the same normalized
  email MUST result in at most one account.
- **[AUTHN-REG-008]** (MUST) Registration MUST record a `user.registered`
  security event for each account created.
- **[AUTHN-REG-009]** (MUST) In `optional` and `off` modes, the new user MUST be
  created in state `active`, registration MUST NOT create a session, and the
  outcome MUST be `accepted`, exactly as in `required` mode. In `optional` mode
  a verification email MUST still be sent.
- **[AUTHN-REG-010]** (MUST) Registering an existing email MUST perform
  password-hashing work of comparable cost to a new registration, so response
  time does not reveal account existence.

## 4. Login — `login(email, password)`

- **[AUTHN-LOGIN-001]** (MUST) Login MUST look up the user by normalized email
  and verify the password against the stored hash using the hashing library's
  verification function.
- **[AUTHN-LOGIN-002]** (MUST) If the user does not exist, is `deleted`, has no
  password credential, or the password is wrong, login MUST fail with
  `INVALID_CREDENTIALS`, with the same response in all four cases.
- **[AUTHN-LOGIN-003]** (MUST) When no matching user exists, the implementation
  MUST still perform a password-hash verification of comparable cost (e.g.
  against a fixed dummy hash) so response time does not reveal account
  existence.
- **[AUTHN-LOGIN-004]** (MUST) The account state MUST be revealed only after
  the password is verified: `pending` → `EMAIL_NOT_VERIFIED`; `suspended` or
  `disabled` → `ACCOUNT_UNAVAILABLE`. No session is created in these cases.
- **[AUTHN-LOGIN-005]** (MUST) On success, the implementation MUST create a
  **new** session (§6) and MUST NOT reuse or adopt any session token supplied by
  the client (session-fixation protection). Any session token the client
  already presented MUST be revoked.
- **[AUTHN-LOGIN-006]** (MUST) Login MUST be rate limited per normalized email
  and per client address ([SEC-RATE-001]); limits apply whether or not the
  account exists.
- **[AUTHN-LOGIN-007]** (SHOULD) If the stored hash uses parameters weaker than
  the current configuration, the implementation SHOULD re-hash the password on
  successful login ([SEC-HASH-004]).
- **[AUTHN-LOGIN-008]** (MUST) Login MUST record `auth.login.succeeded` or
  `auth.login.failed` events. Failed events MUST NOT include the submitted
  password.
- **[AUTHN-LOGIN-009]** (MUST) A successful login response MUST include the
  current user (§7) and MUST NOT include the session token in the body.

## 5. Logout

### 5.1 `logout()`

- **[AUTHN-LOGOUT-001]** (MUST) Logout MUST revoke the current session
  server-side; subsequent requests with that token MUST be unauthenticated.
- **[AUTHN-LOGOUT-002]** (MUST) Logout MUST instruct the client to delete the
  session cookie (same name, path and attributes, expired).
- **[AUTHN-LOGOUT-003]** (MUST) Logout MUST be idempotent: calling it without a
  valid session succeeds and reveals nothing.
- **[AUTHN-LOGOUT-004]** (MUST) Logout is a state-changing operation and MUST be
  CSRF-protected ([SEC-CSRF-001]); it MUST NOT be reachable via a safe method
  (e.g. HTTP `GET`).

### 5.2 `logoutAll()` — logout from all devices

- **[AUTHN-LOGOUT-005]** (MUST) An authenticated user MUST be able to revoke all
  of their sessions, including the current one, in one operation.
- **[AUTHN-LOGOUT-006]** (MUST) `logoutAll` MUST record an
  `auth.sessions.revoked_all` security event.

### 5.3 Session management (recommended)

- **[AUTHN-LOGOUT-007]** (SHOULD) Implementations SHOULD let a user list their
  active sessions (creation time, last use, coarse client description — never
  tokens) and revoke an individual session they own.

## 6. Sessions

- **[AUTHN-SESS-001]** (MUST) Session tokens MUST be generated per
  [SEC-TOKEN-001] (CSPRNG, ≥ 256 bits) and delivered only in a cookie meeting
  [SEC-COOKIE-001].
- **[AUTHN-SESS-002]** (MUST) Only a SHA-256 (or stronger) hash of the session
  token MUST be stored; lookup is by hash.
- **[AUTHN-SESS-003]** (MUST) Each session MUST have an **idle expiry** and an
  **absolute expiry**. A session is valid only if: it exists, is not revoked,
  `now < idleExpiresAt`, `now < absoluteExpiresAt`, and its user is `active`.
- **[AUTHN-SESS-004]** (MUST) Using a valid session MAY extend the idle expiry
  (sliding), but MUST NOT extend it beyond the absolute expiry. The absolute
  expiry MUST NOT be extended.
- **[AUTHN-SESS-005]** (MUST) An invalid, expired or revoked session token MUST
  be treated as unauthenticated (`UNAUTHENTICATED` on protected operations);
  the response MUST NOT reveal which condition applied.
- **[AUTHN-SESS-006]** (MUST) Revocation (logout, logoutAll, password change,
  password reset, account state change) MUST take effect for the very next
  request. Any cache of session state MUST honor this.
- **[AUTHN-SESS-007]** (SHOULD) Writes that extend idle expiry SHOULD be
  throttled (`authentication.sessions.touchIntervalSeconds`, default 60) to
  limit database load.
- **[AUTHN-SESS-008]** (SHOULD) Expired and revoked sessions SHOULD be purged
  periodically by an application-controlled job.
- **[AUTHN-SESS-009]** (MAY) Implementations MAY record IP address and user
  agent at session creation for display and auditing, but MUST NOT use them as
  the sole means of authentication.

## 7. Current user — `getCurrentUser()`

- **[AUTHN-ME-001]** (MUST) With a valid session, the operation MUST return the user's ID, email,
  email-verified flag, state, role names, effective permissions, and session
  expiry times. Without one, it MUST fail with `UNAUTHENTICATED`.
- **[AUTHN-ME-002]** (MUST) The roles and permissions returned MUST be treated
  as informational, for UI purposes only ([AUTHZ-CORE-004]).
- **[AUTHN-ME-003]** (MUST) Responses to this and every other authentication
  operation MUST carry `Cache-Control: no-store` (or the transport's
  equivalent).

## 8. Email verification

### 8.1 `requestEmailVerification(email)` — (re)send

- **[AUTHN-VERIFY-001]** (MUST) The outcome MUST be `accepted` and
  indistinguishable whether the email belongs to a `pending` user, an already
  verified user, or no user ([SEC-ENUM-001]). A token is sent only to a
  `pending` user.
- **[AUTHN-VERIFY-002]** (MUST) Requests MUST be rate limited per normalized
  email and per client address.
- **[AUTHN-VERIFY-003]** (SHOULD) Issuing a new verification token SHOULD
  invalidate earlier unused verification tokens for the same user.

### 8.2 `verifyEmail(token)`

- **[AUTHN-VERIFY-004]** (MUST) Verification tokens MUST be generated per
  [SEC-TOKEN-001], stored only as hashes, and expire after the configured TTL
  (default 24 h, maximum 7 days).
- **[AUTHN-VERIFY-005]** (MUST) A token MUST be accepted only if it exists, is
  unused, is unexpired, and was issued for the user's **current** email
  address. All other cases MUST fail with `TOKEN_INVALID` (one code for every failure reason).
- **[AUTHN-VERIFY-006]** (MUST) A token MUST be usable at most once, including
  under concurrent use (atomic consume).
- **[AUTHN-VERIFY-007]** (MUST) Success MUST set the email-verified timestamp
  and, if the user is `pending`, transition them to `active`.
- **[AUTHN-VERIFY-008]** (SHOULD NOT) Verification SHOULD NOT create a session;
  the user logs in normally afterwards.
- **[AUTHN-VERIFY-009]** (MUST) Links in verification emails MUST be built from
  the configured application base URL, never from request headers such as
  `Host` or `X-Forwarded-Host`.

## 9. Password change — `changePassword(currentPassword, newPassword)`

- **[AUTHN-PWCHG-001]** (MUST) The operation MUST require a valid session and
  the correct current password; a wrong current password MUST fail with
  `INVALID_CREDENTIALS` and MUST be rate limited like login.
- **[AUTHN-PWCHG-002]** (MUST) The new password MUST satisfy the password policy
  ([SEC-PWPOLICY-001] …).
- **[AUTHN-PWCHG-003]** (MUST) On success, all of the user's **other** sessions
  MUST be revoked. The current session MUST either be kept or replaced with a
  newly issued session (recommended: replace).
- **[AUTHN-PWCHG-004]** (MUST) On success, outstanding password-reset tokens for
  the user MUST be invalidated.
- **[AUTHN-PWCHG-005]** (SHOULD) The user SHOULD be notified by email that their
  password changed.
- **[AUTHN-PWCHG-006]** (MUST) A `password.changed` security event MUST be
  recorded.

## 10. Password reset

### 10.1 `requestPasswordReset(email)`

- **[AUTHN-RESET-001]** (MUST) The outcome MUST be `accepted` and
  indistinguishable whether or not the email belongs to an account
  ([SEC-ENUM-001]).
- **[AUTHN-RESET-002]** (MUST) A reset token MUST be issued and emailed only
  for users in state `active` or `pending`, never for `suspended`, `disabled`
  or `deleted` users.
- **[AUTHN-RESET-003]** (MUST) Reset tokens MUST be generated per
  [SEC-TOKEN-001], stored only as hashes, and expire after the configured TTL
  (default 30 minutes, maximum 60 minutes).
- **[AUTHN-RESET-004]** (MUST) Issuing a new reset token MUST invalidate any
  earlier unused reset tokens for the same user.
- **[AUTHN-RESET-005]** (MUST) Requests MUST be rate limited per normalized
  email and per client address.
- **[AUTHN-RESET-006]** (MUST) Reset links MUST be built from the configured
  application base URL ([AUTHN-VERIFY-009]).

### 10.2 `resetPassword(token, newPassword)`

- **[AUTHN-RESET-007]** (MUST) A token MUST be accepted only if it exists, is
  unused, is unexpired, and its user is `active` or `pending`. All other cases
  MUST fail with `TOKEN_INVALID`.
- **[AUTHN-RESET-008]** (MUST) The new password MUST satisfy the password policy.
  A policy violation MUST NOT consume the token.
- **[AUTHN-RESET-009]** (MUST) A token MUST be usable at most once, including
  under concurrent use (atomic consume).
- **[AUTHN-RESET-010]** (MUST) On success, **all** of the user's sessions MUST be
  revoked and all other reset tokens invalidated.
- **[AUTHN-RESET-011]** (MAY) If the user is `pending`, a successful reset MAY
  mark the email verified and activate the account, since the token proves
  control of the mailbox.
- **[AUTHN-RESET-012]** (SHOULD NOT) A successful reset SHOULD NOT create a
  session automatically.
- **[AUTHN-RESET-013]** (MUST) `password.reset.requested` (only when a token was
  actually issued) and `password.reset.completed` events MUST be recorded, and
  the user SHOULD be notified by email after completion.

## 11. HTTP binding (non-normative, used by MVP adapters)

All bodies are JSON. All routes are under a configurable prefix (default
`/auth`). Errors use the envelope in [ERRORS](ERRORS.md).

| Operation | Method & path | Success |
| --- | --- | --- |
| register | `POST /auth/register` | `202 {status:"accepted"}` (all modes; never sets a cookie) |
| login | `POST /auth/login` | `200 {user}` + `Set-Cookie` |
| logout | `POST /auth/logout` | `204` + expired cookie |
| logoutAll | `POST /auth/logout-all` | `204` + expired cookie |
| getCurrentUser | `GET /auth/me` | `200 {user, session}` |
| listSessions | `GET /auth/sessions` | `200 {sessions}` |
| revokeSession | `DELETE /auth/sessions/:id` | `204` |
| requestEmailVerification | `POST /auth/email/verification` | `202 {status:"accepted"}` |
| verifyEmail | `POST /auth/email/verify` `{token}` | `200 {status:"verified"}` |
| changePassword | `POST /auth/password/change` | `204` (+ rotated cookie) |
| requestPasswordReset | `POST /auth/password/reset-request` | `202 {status:"accepted"}` |
| resetPassword | `POST /auth/password/reset` `{token, newPassword}` | `204` |
| deleteAccount | `POST /auth/account/delete` `{currentPassword}` | `204` + expired cookie |

Email links point to **frontend** pages (e.g. `/verify-email#token=…`,
`/reset-password#token=…`) that submit the token with `POST`. Putting the token
in the URL fragment keeps it out of server logs and `Referer` headers; see
[SEC-TOKEN-005].
