# ADR 0003 — Supported installation modes

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Developers adopt SelfAuth in different ways: some want a generator, some want a
library, some want to copy code by hand, and some delegate to an AI agent.

## Decision

SelfAuth supports three installation modes, all producing behavior that meets
the same specification:

| Mode | What the developer gets | Ownership |
| --- | --- | --- |
| **CLI generation** (`npx selfauth init/add`) | Source files, schema, and migrations written into the repository | Fully application-owned |
| **Packages** (optional `@selfauth/*` framework helpers) | Versioned helper libraries the generated code may import | Library code is SelfAuth's; integration code is the application's |
| **Manual templates** | Copyable source code and migrations in `templates/` | Fully application-owned |

AI agents use the **CLI mode** through the `selfauth` skill; they are not a
fourth mode and must not hand-write an implementation where a generator exists.

Generated code MUST work without the optional packages being updated, and MUST
NOT import a package that contacts a SelfAuth service (ADR 0002).

## Consequences

- Templates are the source of truth for both the CLI and manual mode; the CLI
  renders the same templates the manual docs reference.
- Package mode needs a stable public API and semver discipline (ADR 0011).
