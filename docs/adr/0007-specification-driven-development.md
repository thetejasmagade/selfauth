# ADR 0007 — Specification-driven development with requirement IDs

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Multiple adapters in multiple languages must behave identically on
security-relevant points. "Identical" needs a definition that does not depend on
any one framework.

## Decision

1. The normative specification lives in `packages/spec/specs/` and is written in
   language-neutral terms (operations, inputs, outcomes, error codes).
2. Every normative requirement has a stable ID of the form
   `AREA-TOPIC-NNN` (e.g. `AUTHN-LOGIN-003`), written as
   `**[ID]** (LEVEL) text`, where LEVEL is one of
   `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY` (RFC 2119 / RFC 8174).
3. Every `MUST` / `MUST NOT` requirement is covered by at least one
   language-neutral conformance case in `conformance/cases/`, **or** by an entry
   in `conformance/verification.json` that names a non-test verification
   method (code review, static analysis, configuration check, dependency check).
4. This coverage rule is enforced automatically in CI.
5. IDs are never reused. A removed requirement is marked `(WITHDRAWN)` in place.
6. The spec has its own version (`specVersion`), independent of package
   versions. Adapters declare which spec version they conform to.

## Consequences

- Spec changes are reviewable as diffs of individual requirements.
- The generator cannot "define" behavior; it must implement the spec.
