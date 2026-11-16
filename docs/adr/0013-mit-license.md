# ADR 0013 — MIT licence

- **Status:** Accepted
- **Date:** 2026-11-16
- **Supersedes:** ADR 0010

## Context

ADR 0010 chose Apache-2.0 for the SelfAuth repository. The project owner chose
MIT instead: it is the most widely understood permissive licence in the
JavaScript ecosystem and has the lowest adoption friction.

## Decision

1. The SelfAuth repository (CLI, packages, spec tooling, docs) is licensed under
   the **MIT License**.
2. Unchanged from ADR 0010: **generated output and templates** (everything under
   `templates/` and every file the CLI writes into a target project) are
   additionally offered under **0BSD**, so applications may use, modify, and
   relicense generated code without keeping a copyright notice. This keeps the
   "generated code is fully yours" promise (ADR 0004) even for developers who
   copy templates by hand.

## Consequences

- No NOTICE file; MIT has no NOTICE mechanism.
- MIT has no explicit patent grant. Accepted by the owner as a trade-off for
  simplicity.
- Contributions are accepted under MIT, and template contributions under MIT
  and 0BSD (`CONTRIBUTING.md`).
