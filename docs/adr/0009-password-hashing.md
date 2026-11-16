# ADR 0009 — Password hashing with Argon2id

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Password storage is the most damaging thing to get wrong. SelfAuth must not
invent cryptography.

## Decision

- Passwords are hashed with **Argon2id** via a maintained library native to the
  adapter's language (for Node.js: `argon2` or `@node-rs/argon2`; chosen in
  Phase 3).
- Minimum parameters follow current OWASP guidance:
  memory ≥ 19 MiB, iterations ≥ 2, parallelism ≥ 1 — or the equivalent
  "46 MiB / 1 / 1" profile. Defaults are tuned upward when hardware allows.
- Hashes are stored in the PHC string format so parameters can be upgraded;
  a hash with outdated parameters is re-hashed on the next successful login.
- Where Argon2id is unavailable in a target language, scrypt and then bcrypt
  (with input length handling) are the documented fallbacks, decided per
  adapter by ADR.

## Consequences

Native dependencies (Argon2 bindings) must be available for the platforms the
generated application deploys to; adapters document this.
