# ADR 0010 — License

- **Status:** Superseded by ADR-0013
- **Date:** 2026-11-16

## Context

SelfAuth is open source and security-sensitive. Its own code benefits from an
explicit patent grant. Code it *generates* into applications must be owned by
those applications without licence obligations that would surprise developers.

## Decision

1. The SelfAuth repository (CLI, packages, spec tooling, docs) is licensed under
   **Apache License 2.0**.
2. **Generated output and templates** (everything under `templates/` and every
   file the CLI writes into a target project) are additionally offered under the
   **Zero-Clause BSD (0BSD)** licence, so applications may use, modify, and
   relicense them with no attribution requirement. Each template package will
   carry this grant explicitly once templates exist.

## Consequences

- No NOTICE-file obligations leak into generated applications.
- Contributors agree their template contributions may be distributed under 0BSD
  (stated in `CONTRIBUTING.md`).

## Alternatives considered

- *MIT for everything* — simpler, but lacks an explicit patent grant.
- *Apache-2.0 for generated code* — would require attribution in every app.
