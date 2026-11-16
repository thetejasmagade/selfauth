# ADR 0008 — Opaque server-side sessions by default

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Browser authentication can use stateless signed tokens (e.g. JWT in cookies or
storage) or opaque session identifiers backed by server-side state.

## Decision

The default and only MVP strategy for browser clients is an **opaque,
high-entropy session token** delivered in an `HttpOnly`, `Secure` cookie, whose
SHA-256 hash is stored server-side with expiry and revocation state.

Stateless tokens may be added later as an *API access-token profile* (an
optional capability), never as the default browser session.

## Consequences

- Logout, logout-everywhere, suspension, and password-reset revocation take
  effect immediately — a requirement of the spec.
- Each authenticated request costs one session lookup; adapters may add a cache
  only if revocation still takes effect immediately.
- No signing secret is required for sessions, which removes a class of key
  management mistakes.

## Alternatives considered

- *JWT sessions* — revocation requires a deny-list (i.e. server state anyway),
  tokens are commonly misused (algorithm confusion, storage in `localStorage`),
  and payloads leak claims.
