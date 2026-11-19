---
title: HTTP API
description: Reference for every route the generated SelfAuth backend serves under /auth - bodies, responses, errors, cookies, CSRF, rate limits and email links - with curl examples.
keywords: [http api, rest, /auth/login, /auth/register, csrf, cookies, endpoints, status codes]
---

# HTTP API

These are the routes the generated Express, Fastify and Gin backends serve under `http.basePath` (`/auth` by default), and they behave the same on all three. The normative behavior is in the [authentication specification](https://github.com/thetejasmagade/selfauth/blob/main/packages/spec/specs/AUTHENTICATION_SPEC.md). This page is the practical version. A test in the SelfAuth repository checks that the routes listed below match what the server really registers.

## Conventions

- Bodies are JSON (`Content-Type: application/json`), capped at `http.bodyLimitBytes` (16 KiB by default). Anything larger gets `413 PAYLOAD_TOO_LARGE`.
- The session is an opaque token in an `HttpOnly` cookie, `__Host-session` by default and `dev_session` in development. Browsers send it automatically. Use `credentials: "include"` when the API is on another origin.
- Every `POST`, `PUT`, `PATCH` and `DELETE` must come from a trusted origin and carry the CSRF header. In `header` mode (the default) that's `X-SelfAuth-CSRF: 1`. In `token` mode it's `X-SelfAuth-CSRF: <csrfToken>`, using the `csrfToken` returned by `login`, `me` and `password/change`.

- A request that fails either check gets `403 CSRF_FAILED`. This covers the whole app, not just `/auth`.
- Errors always look like `{ "error": { "code": "…", "message": "…", "requestId": "…" } }`. Branch on `code` and never on `message`. Every response also carries an `X-Request-Id` header. See [Error codes](./errors).
- Rate limits apply per account and per IP address to `login`, `register`, `password/change`, `password/reset-request` and `email/verification`. Go over and you get `429 RATE_LIMITED` with a `Retry-After` header.
- `register`, `password/reset-request` and `email/verification` answer the same way whether or not the email exists, and `login` returns the same `INVALID_CREDENTIALS` for an unknown email and a wrong password.
- Authentication responses are sent with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

The `user` object is `{ id, email, emailVerified, state, roles, permissions }` and never includes credentials.

## Registration and sessions

| Route | Body | Success | Typical errors |
| --- | --- | --- | --- |
| `POST /auth/register` | `{ email, password }` | `202 {status:"accepted"}`. With `registration.revealExistingEmail`: `409 EMAIL_TAKEN` for a known email. With `signInAfterRegistration`: `201 {user}` and a session cookie | `VALIDATION_FAILED`, `PASSWORD_POLICY_VIOLATION`, `RATE_LIMITED` |
| `POST /auth/login` | `{ email, password }` | `200 {user, csrfToken?}` and a session cookie (a new session ID each time) | `INVALID_CREDENTIALS`, `EMAIL_NOT_VERIFIED`, `ACCOUNT_UNAVAILABLE`, `RATE_LIMITED` |
| `POST /auth/logout` | — | `204`, cookie cleared | `CSRF_FAILED` |
| `POST /auth/logout-all` | — | `204`; every session of the user is revoked | `UNAUTHENTICATED` |
| `GET /auth/me` | — | `200 {user, session, csrfToken?}` | `UNAUTHENTICATED` |
| `GET /auth/sessions` | — | `200 {sessions}` (the user's active sessions, with `current`) | `UNAUTHENTICATED` |
| `DELETE /auth/sessions/:id` | — | `204` | `NOT_FOUND` (not yours or unknown) |
| `POST /auth/account/delete` | `{ currentPassword }` | `204`; account deleted, cookie cleared | `INVALID_CREDENTIALS`, `CONFLICT` (last admin) |

## Email verification and passwords

| Route | Body | Success | Typical errors |
| --- | --- | --- | --- |
| `POST /auth/email/verification` | `{ email }` | `202 {status:"accepted"}` (re-sends the verification link) | `RATE_LIMITED` |
| `POST /auth/email/verify` | `{ token }` | `200 {status:"verified"}` | `TOKEN_INVALID` (expired, used or unknown: always the same code) |
| `POST /auth/password/change` | `{ currentPassword, newPassword }` | `200 {status:"changed", csrfToken?}`; other sessions revoked, cookie rotated | `INVALID_CREDENTIALS`, `PASSWORD_POLICY_VIOLATION`, `RATE_LIMITED` |
| `POST /auth/password/reset-request` | `{ email }` | `202 {status:"accepted"}` | `RATE_LIMITED` |
| `POST /auth/password/reset` | `{ token, newPassword }` | `204`; all sessions revoked | `TOKEN_INVALID`, `PASSWORD_POLICY_VIOLATION` |

## Administration

These routes need a permission plus a recent password entry, within `authorization.reauthenticationWindowMinutes` (15 by default). If the session is too old you get `REAUTHENTICATION_REQUIRED` and the admin has to sign in again.

| Route | Body | Success | Typical errors |
| --- | --- | --- | --- |
| `POST /auth/admin/users/:id/state` | `{ state: "active" \| "suspended" \| "disabled" \| "deleted" }` | `204`; anything but `active` revokes the user's sessions | `FORBIDDEN` (needs `auth.users.manage`), `REAUTHENTICATION_REQUIRED`, `CONFLICT` (transition not allowed, or the last admin), `NOT_FOUND` |
| `POST /auth/admin/users/:id/roles` | `{ role }` | `204` | `FORBIDDEN` (needs `auth.roles.assign`, and no granting permissions you don't hold), `REAUTHENTICATION_REQUIRED`, `NOT_FOUND` |
| `DELETE /auth/admin/users/:id/roles/:role` | — | `204` | Same as assigning, plus `CONFLICT` (removing the last admin) |

Some rules are enforced for you: you can't grant a permission you don't hold, and the last administrator can't be removed, suspended or deleted. The first administrator is created on the server. See [Permissions and roles](/express/permissions).

## Email links

Verification and reset emails link to frontend pages built from `SELFAUTH_APP_BASE_URL`:

- `<app>/verify-email#token=…`, where the page POSTs `{ token }` to `/auth/email/verify`.
- `<app>/reset-password#token=…`, where the page POSTs `{ token, newPassword }` to `/auth/password/reset`.

The token sits in the URL fragment, so it never reaches server logs or `Referer` headers. The generated Vue and React apps include both pages.

## Example session

```bash
curl -s -c jar -b jar -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' \
  http://localhost:3000/auth/login -d '{"email":"a@example.com","password":"correct horse battery staple"}'
curl -s -b jar http://localhost:3000/auth/me
```

For a walkthrough with real responses, see [Try the authentication flow](/express/run-and-sign-in).

## From JavaScript

```ts
const response = await fetch("/auth/login", {
  method: "POST",
  credentials: "include",                         // send and receive the cookie
  headers: { "Content-Type": "application/json", "X-SelfAuth-CSRF": "1" },
  body: JSON.stringify({ email, password }),
});
const body = await response.json();
if (!response.ok) console.error(body.error.code);   // e.g. "INVALID_CREDENTIALS"
```

With a generated frontend you rarely need to write this yourself, because the [client](./client) does it.
