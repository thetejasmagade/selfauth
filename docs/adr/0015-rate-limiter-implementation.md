# ADR 0015 — Rate limiter implementation

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

The Phase 3 plan proposed `rate-limiter-flexible`. On inspection, its memory
store reads `Date.now()` directly and expires keys with `setTimeout`; there is
no way to inject a clock. Conformance cases advance time deterministically
(e.g. "after 60 minutes a temporary block has ended", SEC-RATE-003), and the
spec needs per-account keys that are checked before and counted only on
failure (SEC-RATE-001), which does not match a simple middleware model.

## Decision

The reference implementation ships a small fixed-window limiter
(`auth/core/rate-limit.ts`, ~100 lines) with:

- an injected `Clock`, so every behavior is testable without real waiting;
- `check` (no count), `hit` (count) and `reset` operations, so login can count
  failures per account while counting all attempts per address;
- exponential back-off (block = window × 2^(strikes−1), capped at 24 h,
  strikes decaying after 24 h) and temporary blocks only (SEC-RATE-003);
- a `RateLimitStore` interface, with an in-memory store for one instance and a
  shared store (database or Redis) required for multi-instance deployments
  (SEC-RATE-006, Phase 4).

Rate limiting is not cryptography, so this does not conflict with the rule
against custom cryptography.

## Consequences

- One more component we maintain; it is covered by unit tests and by the
  conformance rate-limit cases.
- Applications that prefer `rate-limiter-flexible` or an edge/WAF limiter can
  add it in front; the spec behaviors must still hold.
