# HTTP API

The routes the generated Express code serves under `http.basePath`
(default `/auth`). The normative behaviour is in
[`AUTHENTICATION_SPEC.md` §11](../../packages/spec/specs/AUTHENTICATION_SPEC.md#11-http-binding-non-normative-used-by-mvp-adapters).
This page is the practical reference. A test checks that the route table
below matches the routes the server actually registers.

## Conventions

- **Bodies** are JSON (`Content-Type: application/json`) and limited to
  `http.bodyLimitBytes` (default 16 KiB). Larger bodies get
  `413 PAYLOAD_TOO_LARGE`.
- **Session** is an opaque token in an `HttpOnly` cookie, named
  `__Host-session` by default (SEC-COOKIE-001). Browsers send it
  automatically. Use `credentials: "include"` when the API is on another
  origin.
- **CSRF**: every `POST`, `PUT`, `PATCH` and `DELETE` must come from a
  trusted origin and carry the CSRF header (SEC-CSRF-004):
  - `header` mode (default): `X-SelfAuth-CSRF: 1`.
  - `token` mode: `X-SelfAuth-CSRF: <csrfToken>`, using the `csrfToken`
    returned by `login`, `me` and `password/change`.

  A request that fails either check gets `403 CSRF_FAILED`. This applies to
  the whole app, not only `/auth`.
- **Errors** always look like
  `{ "error": { "code": "…", "message": "…", "requestId": "…" } }`. Branch on
  `code`, never on `message`
  ([ERRORS.md](../../packages/spec/specs/ERRORS.md)). Every response carries
  `X-Request-Id`.
- **Rate limits** apply per account and per IP address to `login`,
  `register`, `password/change`, `password/reset-request` and
  `email/verification`. When exceeded, the response is `429 RATE_LIMITED`
  with a `Retry-After` header.
- **Enumeration safety**: `register`, `password/reset-request` and
  `email/verification` answer the same way whether or not the email exists.
  `login` returns the same `INVALID_CREDENTIALS` for an unknown email and for
  a wrong password.

## Routes

| Route | Body | Success | Typical errors |
| --- | --- | --- | --- |
| `POST /auth/register` | `{ email, password }` | `202 {status:"accepted"}`. With `registration.revealExistingEmail`: `409 EMAIL_TAKEN` for a known email. With `signInAfterRegistration`: `201 {user}` and a session cookie | `VALIDATION_FAILED`, `PASSWORD_POLICY_VIOLATION`, `RATE_LIMITED` |
| `POST /auth/login` | `{ email, password }` | `200 {user, csrfToken?}` and a session cookie (a new session ID each time) | `INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_UNAVAILABLE`, `RATE_LIMITED` |
| `POST /auth/logout` | — | `204`, cookie cleared | `CSRF_FAILED` |
| `POST /auth/logout-all` | — | `204`; every session of the user is revoked | `UNAUTHENTICATED` |
| `GET /auth/me` | — | `200 {user, session, csrfToken?}` | `UNAUTHENTICATED` |
| `GET /auth/sessions` | — | `200 {sessions}` (the user's active sessions, with `current`) | `UNAUTHENTICATED` |
| `DELETE /auth/sessions/:id` | — | `204` | `NOT_FOUND` (not yours or unknown) |
| `POST /auth/email/verification` | `{ email }` | `202 {status:"accepted"}` (re-sends the verification link) | `RATE_LIMITED` |
| `POST /auth/email/verify` | `{ token }` | `200 {status:"verified"}` | `TOKEN_INVALID` (expired, used or unknown: always the same code) |
| `POST /auth/password/change` | `{ currentPassword, newPassword }` | `200 {status:"changed", csrfToken?}`; other sessions revoked, cookie rotated | `INVALID_CREDENTIALS`, `PASSWORD_POLICY_VIOLATION`, `RATE_LIMITED` |
| `POST /auth/password/reset-request` | `{ email }` | `202 {status:"accepted"}` | `RATE_LIMITED` |
| `POST /auth/password/reset` | `{ token, newPassword }` | `204`; all sessions revoked | `TOKEN_INVALID`, `PASSWORD_POLICY_VIOLATION` |
| `POST /auth/account/delete` | `{ currentPassword }` | `204`; account deleted, cookie cleared | `INVALID_CREDENTIALS`, `CONFLICT` (last admin) |
| `POST /auth/admin/users/:id/state` | `{ state: "active" \| "suspended" \| "disabled" \| "deleted" }` | `204`; anything but `active` revokes the user's sessions | `FORBIDDEN` (needs `auth.users.manage`), `REAUTHENTICATION_REQUIRED`, `CONFLICT` (transition not allowed, or the last admin), `NOT_FOUND` |
| `POST /auth/admin/users/:id/roles` | `{ role }` | `204` | `FORBIDDEN` (needs `auth.roles.assign`, and no granting permissions you don't hold), `REAUTHENTICATION_REQUIRED`, `NOT_FOUND` |
| `DELETE /auth/admin/users/:id/roles/:role` | — | `204` | Same as assigning, plus `CONFLICT` (removing the last admin) |

`user` is `{ id, email, emailVerified, state, roles, permissions }`. It never
includes credentials. Admin routes need a recent password entry, within
`authorization.reauthenticationWindowMinutes` (AUTHZ-ADMIN-004).

## Email links

Verification and reset emails link to **frontend** pages built from
`SELFAUTH_APP_BASE_URL`:

- `<app>/verify-email#token=…` → the page POSTs `{ token }` to `/auth/email/verify`;
- `<app>/reset-password#token=…` → the page POSTs `{ token, newPassword }` to `/auth/password/reset`.

The token sits in the URL fragment, so it never reaches server logs or
`Referer` headers (SEC-TOKEN-005). The generated Vue and React apps include
both pages.

## Example

```bash
curl -s -c jar -b jar -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' \
  http://localhost:3000/auth/login -d '{"email":"a@example.com","password":"correct horse battery staple"}'
curl -s -b jar http://localhost:3000/auth/me
```
