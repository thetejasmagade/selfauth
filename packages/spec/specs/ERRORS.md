# Errors

- **specVersion:** 0.1 (draft — open for review)

## Envelope

- **[ERR-FORMAT-001]** (MUST) Every failed operation MUST return an error with a
  stable machine-readable `code` from the table below and a human-readable
  `message`. Over HTTP the body is:

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Email or password is incorrect.",
    "requestId": "01J…",
    "details": [{ "field": "email", "issue": "invalid_format" }]
  }
}
```

- **[ERR-FORMAT-002]** (MUST) `details` MAY be present only for
  `VALIDATION_FAILED` and `PASSWORD_POLICY_VIOLATION`, and MUST describe only
  the client's own input.
- **[ERR-FORMAT-003]** (MUST) Clients and conformance tests MUST rely on `code`,
  never on `message` text; messages MAY be localized.
- **[ERR-FORMAT-004]** (MUST NOT) Errors MUST NOT be more specific than this table
  allows (e.g. no "user not found" vs "wrong password", no "token expired" vs
  "token used").

## Codes

| Code | HTTP | When | Enumeration-safe? |
| --- | --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Malformed or missing input | Yes |
| `PASSWORD_POLICY_VIOLATION` | 400 | Password fails policy (details list the rule) | Yes |
| `INVALID_CREDENTIALS` | 401 | Unknown user, deleted user, or wrong password | Yes — identical for all causes |
| `UNAUTHENTICATED` | 401 | No valid session for a protected operation | Yes |
| `EMAIL_NOT_VERIFIED` | 403 | Correct password, account `pending` | Revealed only after password verified |
| `ACCOUNT_UNAVAILABLE` | 403 | Correct password, account `suspended`/`disabled` | Revealed only after password verified |
| `FORBIDDEN` | 403 | Authenticated but not permitted | — |
| `REAUTHENTICATION_REQUIRED` | 403 | Operation needs recent password entry | — |
| `CSRF_FAILED` | 403 | Origin/CSRF verification failed | — |
| `NOT_FOUND` | 404 | Resource absent or hidden from subject | Yes |
| `TOKEN_INVALID` | 400 | Any one-time-token failure | Yes — identical for all causes |
| `EMAIL_TAKEN` | 409 | Only in `optional`/`off` verification modes | **No** (documented trade-off) |
| `CONFLICT` | 409 | State conflict (e.g. removing last admin) | — |
| `RATE_LIMITED` | 429 | Rate limit exceeded; `Retry-After` header | Yes |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeds limit | Yes |
| `INTERNAL_ERROR` | 500 | Unexpected failure; no internals exposed | Yes |
