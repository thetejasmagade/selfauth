---
title: Security model
description: What SelfAuth protects against and how - password hashing, sessions, one-time tokens, CSRF, rate limits, account enumeration, logging, administration - plus what it does not cover and the current assurance level.
keywords: [security, argon2id, session security, csrf, rate limiting, account enumeration, owasp, threat model, cookies, hashing]
---

# Security model

This page explains what the generated code does to protect your users, so you can judge it and know what remains your responsibility.

::: warning Assurance level
SelfAuth is pre-alpha. The Express reference implementation has been reviewed by its maintainers and by one automated hostile review. **No independent human security audit has been done**, and one is required before 1.0. Read the [security review](https://github.com/thetejasmagade/selfauth/blob/main/docs/security-review.md) and have your own reviewer look at anything that protects real users.
:::

## Passwords

| Protection | How |
| --- | --- |
| Slow, memory-hard hashing | **Argon2id**, default 19 MiB of memory, 2 iterations, 1 lane (the OWASP minimum). Configuration cannot go below the floor |
| Standard storage format | The hash is stored as a PHC string with its own salt and parameters, in `auth_credentials`, apart from the user row |
| Weak passwords refused | Minimum length 8 (you may raise it), maximum 128, and a list of very common passwords is rejected. There is no forced rotation |
| Constant work for unknown users | Signing in with an unknown email still runs a hash, so timing does not reveal accounts |

## Sessions

| Protection | How |
| --- | --- |
| Unguessable tokens | 32 random bytes from the system's secure generator, base64url |
| A stolen database is not a stolen session | Only the **SHA-256 hash** of a token is stored |
| Cookie flags | `HttpOnly` (JavaScript cannot read it), `Secure`, `SameSite=Lax`, and the `__Host-` prefix (bound to your exact host, no `Domain`) |
| Immediate revocation | The session is looked up on **every** request, so logout, password change and suspension take effect at once |
| Fixation defense | A new session is created at sign-in and password change; the old one is revoked |
| Limited lifetime | Idle timeout (7 days) and absolute timeout (30 days), both configurable |
| Control for users | List sessions, revoke one, sign out everywhere |

## One-time tokens (verification and reset)

- 32 random bytes; only the hash is stored.
- **Single use**: consuming a token is a conditional database update, so two parallel requests cannot both succeed.
- Short lifetimes: 24 hours for verification and 30 minutes for resets by default.
- Requesting a new token invalidates the older ones. A password reset revokes **all** sessions.
- The same `TOKEN_INVALID` answer covers expired, used and unknown tokens.
- Links carry the token in the URL **fragment**, so it never reaches server logs or `Referer` headers.

## CSRF

Cross-site request forgery is blocked in two layers:

1. `SameSite=Lax` cookies are not sent on cross-site POSTs.
2. Every `POST`, `PUT`, `PATCH` and `DELETE` must come from a trusted origin and carry the `X-SelfAuth-CSRF` header. A website on another origin cannot add a custom header without your server's permission.

For cross-site deployments (`SameSite=None`) the header carries a signed token bound to the session (`token` mode), with an HMAC secret you provide and can rotate. This covers your **whole** app, not only `/auth`. See [Frontend deployment](/configuration/frontend-deployment).

## Rate limits and brute force

Per-account and per-address limits on sign-in, registration, password change, reset requests and verification resends. The attempt is counted atomically **before** the password is checked, so parallel guesses cannot exceed the limit (a flaw in an earlier version, found by the review and fixed). Counters are shared across app instances on PostgreSQL, MySQL and MongoDB.

Behind a proxy, set `http.trustProxy` so the real client address is used, and forwarding headers are never trusted otherwise.

## Account enumeration

Attackers try to learn which emails have accounts. SelfAuth gives **identical** answers for known and unknown emails on registration (`202`), reset requests (`202`) and verification resends (`202`), and the same `INVALID_CREDENTIALS` on sign-in, with the same work done in both cases. People who already have an account get an `accountExists` email instead. Turning on `revealExistingEmail` trades this away on purpose.

## Authorization

- **Deny by default** with `protectedRoutes`: a route with no explicit guard is refused.
- Permissions are read from the database on every request. The browser cannot grant itself any.
- Unknown permissions in a guard are a startup error, not a silent denial.
- Resource policies load the resource from **your storage**, and hide other people's resources with `404`.
- Admin operations need `auth.*` permissions **and** a recent password entry. You cannot grant permissions you do not hold. The last administrator cannot be removed.
- The first administrator can only be created by a command you run on the server.

## Logging and data

- Logs never contain bodies, query strings, cookies, passwords or tokens (redacted by the logger).
- A security event log (`auth_security_events`) records sign-ins, failures, password and role changes and admin actions.
- Error responses never expose internals; the details stay in the server log, keyed by `requestId`.
- After account deletion the email and password are removed. See [Data retention](./data-retention).

## Other protections

| Topic | Protection |
| --- | --- |
| Request size | Bodies are limited (16 KiB by default) |
| Redirects | The frontend follows only same-site relative paths (`safeRedirect`) |
| Caching | `Cache-Control: no-store` on authentication responses |
| Referrers | `Referrer-Policy: no-referrer` |
| HTTPS | In production the server refuses to start unless the cookie is `Secure` and the app address is `https://` |
| Secrets | Never in the configuration file or the repository. A test checks the generated `.env.example` and `.gitignore` |
| Supply chain | No SelfAuth runtime dependency. Dependencies are scanned in CI (CodeQL, gitleaks, dependency audit) |

## What is not covered

You still need to handle:

- **Email delivery security**: a verification or reset link is only as safe as your mail provider.
- **HTTPS, HSTS and your server's hardening.**
- **Multi-factor authentication, social login, magic links**: not implemented.
- **Your own routes**: guard them, validate input, and use ownership policies.
- **Backups and database access control.**
- **A distributed rate limit on SQLite or in-memory** (single process only).
- **Timing side channels**: no timing test has been done yet.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub private vulnerability reporting, as described in the [security policy](https://github.com/thetejasmagade/selfauth/blob/main/SECURITY.md). Because you own the generated code, advisories include how to detect and patch affected code in your project by hand.

## Next

- [Going to production](./production)
