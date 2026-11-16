# ADR 0014 — Argon2id library for Node.js adapters

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

ADR 0009 requires Argon2id through a maintained library. Two mature options
exist for Node.js: `argon2` (node-gyp-build bindings) and `@node-rs/argon2`
(Rust implementation with prebuilt N-API binaries).

## Decision

Node.js adapters use **`@node-rs/argon2`**.

- Prebuilt binaries for common platforms: developers do not need a C/C++
  toolchain, which matters for a generator that installs into many projects.
- Hashing runs on a worker thread (SEC-HASH-006) and emits PHC strings
  (SEC-HASH-003) with random 16-byte salts.
- Measured at the spec minimum (19 MiB, t=2, p=1): ~19 ms per hash; parallel
  verification scales across cores.

The library exports `Algorithm` as a const enum, which erasable-syntax
TypeScript cannot reference, so the reference code uses the numeric value
`2` (Argon2id) with a comment; the conformance suite asserts `$argon2id$`.

## Consequences

- Platforms without a prebuilt binary need a fallback; `argon2` is the
  documented alternative with the same API shape.
