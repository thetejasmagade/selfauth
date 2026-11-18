---
title: Error codes
description: Every error code the SelfAuth API returns with its HTTP status, when it happens and how to handle it. The error envelope, rules for clients and which codes are safe from account enumeration.
keywords: [error codes, INVALID_CREDENTIALS, UNAUTHENTICATED, FORBIDDEN, CSRF_FAILED, RATE_LIMITED, TOKEN_INVALID, error envelope]
---

# Error codes

## The envelope

Every failed request returns JSON in this shape:

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Email or password is incorrect.",
    "requestId": "4f9b2df3-8a60-45ba-a5c0-b8a144b03d3a",
    "details": [{ "field": "email", "issue": "invalid_format" }]
  }
}
```

| Field | Meaning |
| --- | --- |
| `code` | A stable machine-readable code from the table below. **Branch on this.** |
| `message` | A human-readable sentence. It may change or be localized: never compare it |
| `requestId` | The same id as the `X-Request-Id` response header. Quote it when you look in the logs |
| `details` | Only for `VALIDATION_FAILED` and `PASSWORD_POLICY_VIOLATION`. Describes only the input the client sent |

Errors are never more specific than the table allows: there is no "user not found" versus "wrong password", and no "token expired" versus "token already used".

## The codes

| Code | HTTP | When | How to handle it |
| --- | :---: | --- | --- |
| `VALIDATION_FAILED` | 400 | Malformed or missing input, or malformed JSON | Show the field problems from `details` |
| `PASSWORD_POLICY_VIOLATION` | 400 | The password breaks the policy (too short, too long, too common) | Show the rule from `details` |
| `TOKEN_INVALID` | 400 | A one-time token failed: expired, already used, or unknown. Always the same code | Ask the user to request a new link |
| `INVALID_CREDENTIALS` | 401 | Unknown user, deleted user or wrong password. Identical for all causes | Show "email or password is incorrect" |
| `UNAUTHENTICATED` | 401 | No valid session for a protected operation | Send the user to sign in |
| `EMAIL_NOT_VERIFIED` | 403 | The password is correct but the account is `pending` | Offer to resend the verification email |
| `ACCOUNT_UNAVAILABLE` | 403 | The password is correct but the account is `suspended` or `disabled` | Tell the user to contact support |
| `FORBIDDEN` | 403 | Signed in but not permitted | Show "not allowed" |
| `REAUTHENTICATION_REQUIRED` | 403 | The operation needs a recent password entry (admin routes) | Ask the user to sign in again |
| `CSRF_FAILED` | 403 | The origin or CSRF header check failed | Send the `X-SelfAuth-CSRF` header; check trusted origins. See [Troubleshooting](/troubleshooting#403-csrf_failed) |
| `NOT_FOUND` | 404 | The resource does not exist, **or the user may not know it exists** | Show "not found" |
| `EMAIL_TAKEN` | 409 | Registering a known email, **only when** `registration.revealExistingEmail` is on | Tell the user to sign in |
| `CONFLICT` | 409 | A state conflict, for example removing the last administrator | Show the conflict |
| `PAYLOAD_TOO_LARGE` | 413 | The body is larger than `http.bodyLimitBytes` | Send less data |
| `RATE_LIMITED` | 429 | A rate limit was exceeded. The `Retry-After` header says how many seconds to wait | Wait, then retry |
| `INTERNAL_ERROR` | 500 | An unexpected failure. No internals are exposed | Retry later; look the `requestId` up in the server log |

The frontend client adds two codes of its own: `NETWORK_ERROR` (the request did not complete) and `UNEXPECTED_RESPONSE` (the server's answer was not understood).

## Which codes are enumeration-safe

An attacker must not be able to tell whether an email has an account. The codes that could leak that fact are therefore deliberately blunt:

- `INVALID_CREDENTIALS` is the same for an unknown email, a deleted account and a wrong password.
- `EMAIL_NOT_VERIFIED` and `ACCOUNT_UNAVAILABLE` are shown **only after the password was verified**, so they reveal nothing to someone who does not know it.
- `EMAIL_TAKEN` exists only as an explicit opt-in trade-off.
- Registration, password-reset requests and verification resends answer `202` whatever the email.

## Handling errors in your own routes

Return your own errors in the same envelope so clients can treat them alike:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "item is required.", "requestId": "..." } }
```

In Express, throw `new HttpError(status, code, message)` from `src/http/errors.ts`; the app's error handler formats it. Do not leak stack traces, SQL or file paths.

## Next

- [Server API (TypeScript)](./server)
