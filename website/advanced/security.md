---
title: Security model
description: What SelfAuth protects against and how - password hashing, sessions, one-time tokens, CSRF, rate limits, account enumeration, logging, administration - plus what it does not cover and the current assurance level.
keywords: [security, argon2id, session security, csrf, rate limiting, account enumeration, owasp, threat model, cookies, hashing]
---

# Security model

This page lists what the generated code does to protect your users, so you can judge it for yourself and see what's still your job.

::: warning Assurance level

SelfAuth is pre-alpha. The Express reference implementation has been reviewed by its maintainers and by one automated hostile review, but no independent person has audited it, and an outside audit is required before 1.0. Read the [security review](https://github.com/thetejasmagade/selfauth/blob/main/docs/security-review.md), and have your own reviewer look at anything that protects real users.

:::

## Passwords

| Protection | How |
| --- | --- |
| Slow, memory-hard hashing | Argon2id, default 19 MiB of memory, 2 iterations, 1 lane (the OWASP minimum). Configuration cannot go below the floor |
| Standard storage format | The hash is stored as a PHC string with its own salt and parameters, in `auth_credentials`, apart from the user row |
| Weak passwords refused | Minimum length 8 (you may raise it), maximum 128, and a list of very common passwords is rejected. There is no forced rotation |
| Constant work for unknown users | Signing in with an unknown email still runs a hash, so timing does not reveal accounts |

## Sessions

| Protection | How |
| --- | --- |
| Unguessable tokens | 32 random bytes from the system's secure generator, base64url |
| A stolen database is not a stolen session | Only the SHA-256 hash of a token is stored |
| Cookie flags | `HttpOnly` (JavaScript cannot read it), `Secure`, `SameSite=Lax`, and the `__Host-` prefix (bound to your exact host, no `Domain`) |
| Immediate revocation | The session is looked up on every request, so logout, password change and suspension take effect at once |
| Fixation defense | A new session is created at sign-in and password change; the old one is revoked |
| Limited lifetime | Idle timeout (7 days) and absolute timeout (30 days), both configurable |
| Control for users | List sessions, revoke one, sign out everywhere |

## One-time tokens (verification and reset)

- Tokens are 32 random bytes, and only their hash is stored.
- A token can be used once. Consuming it is a conditional database update, so two parallel requests can't both succeed.
- Lifetimes are short by default: 24 hours for verification and 30 minutes for password resets.
- Asking for a new token invalidates the older ones, and a password reset revokes every session.
- Expired, used and unknown tokens all get the same `TOKEN_INVALID` answer.
- Links carry the token in the URL fragment, so it never reaches server logs or `Referer` headers.

## CSRF

Cross-site request forgery is blocked in two layers:

1. `SameSite=Lax` cookies aren't sent on cross-site POSTs.
2. Every `POST`, `PUT`, `PATCH` and `DELETE` must come from a trusted origin and carry the `X-SelfAuth-CSRF` header. A page on another origin can't add a custom header unless your server allows it.

For cross-site deployments (`SameSite=None`) the header carries a signed token tied to the session (`token` mode), using an HMAC secret you provide and can rotate. This covers your whole app, not just `/auth`. See [Frontend deployment](/configuration/frontend-deployment).

## Rate limits and brute force

Sign-in, registration, password change, reset requests and verification resends all have per-account and per-address limits. The attempt is counted atomically before the password is checked, so parallel guesses can't exceed the limit. (An earlier version had a flaw here. The review found it and it's fixed.) PostgreSQL, MySQL and MongoDB share the counters across app instances.

Behind a proxy, set `http.trustProxy` so the real client address is used. Forwarding headers aren't trusted otherwise.

## Account enumeration

Attackers try to find out which emails have accounts. SelfAuth answers identically for known and unknown emails on registration, reset requests and verification resends (all `202`), and returns the same `INVALID_CREDENTIALS` on sign-in, doing the same amount of work either way. Someone who already has an account gets an `accountExists` email instead. Turning on `revealExistingEmail` gives this up on purpose.

## Authorization

- `protectedRoutes` denies by default, so a route with no explicit guard is refused.
- Permissions are read from the database on every request, and the browser can't grant itself any.
- An unknown permission in a guard is a startup error, not a silent denial.
- Resource policies load the resource from your storage and hide other people's resources behind a `404`.
- Admin operations need `auth.*` permissions and a recent password entry. You can't grant permissions you don't hold, and the last administrator can't be removed.
- The first administrator can only be created by a command you run on the server.

## Logging and data

- Logs never contain bodies, query strings, cookies, passwords or tokens. The logger redacts them.
- A security event log (`auth_security_events`) records sign-ins, failures, password and role changes, and admin actions.
- Error responses never expose internals. The details stay in the server log, keyed by `requestId`.
- After an account is deleted, the email and password are gone. See [Data retention](./data-retention).

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

These are still yours to handle:

- Email delivery. A verification or reset link is only as safe as your mail provider.
- HTTPS, HSTS and hardening your server.
- Multi-factor authentication, social login and magic links, none of which exist yet.
- Your own routes: guard them, validate input and use ownership policies.
- Backups and database access control.
- Distributed rate limiting on SQLite or the in-memory store, which are single process.
- Timing side channels. No timing test has been done yet.

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private vulnerability reporting, as described in the [security policy](https://github.com/thetejasmagade/selfauth/blob/main/SECURITY.md). Since you own the generated code, advisories explain how to spot and patch affected code in your project by hand.
