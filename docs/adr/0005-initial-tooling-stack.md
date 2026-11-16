# ADR 0005 — Initial tooling stack

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

The generator, specification tooling, and first adapters need a single,
well-supported toolchain. Future adapters (Go, C#, Python, Java) will use their
own native tooling; this ADR covers the SelfAuth repository itself.

## Decision

| Area | Choice | Rationale |
| --- | --- | --- |
| Tooling language | TypeScript (strict) | Matches the first adapters (Express, Vue, React); one language for CLI and templates |
| TypeScript version | 6.0.x | typescript-eslint does not yet support the 7.x native compiler; revisit when it does |
| Runtime | Node.js ≥ 22 (LTS) | Node 20 reached end of life in April 2026 |
| Package manager | pnpm (workspaces) | Strict dependency isolation catches undeclared dependencies |
| Monorepo orchestration | Turborepo | Task graph + caching with low configuration |
| CLI framework | Commander.js | Mature, widely known, good subcommand support (chosen over CAC for ecosystem familiarity) |
| Config validation | Zod 4 | Runtime validation + inferred types; can emit JSON Schema for non-TS adapters |
| Unit/integration tests | Vitest | Fast, ESM-native, TypeScript without a build step |
| Browser / E2E tests | Playwright | Cross-browser; needed from Phase 5 |
| Documentation site | VitePress | Markdown-first; added in Phase 12 |
| CI | GitHub Actions | Repository is hosted on GitHub |
| Distribution | npm | Primary ecosystem of the MVP adapters |
| Versioning | Changesets | Per-package semver with reviewed changelogs |
| Lint / format | ESLint (flat config) + typescript-eslint, Prettier | Standard, low-friction |

## Consequences

- Contributors need Node 22+ and pnpm (pinned via `packageManager`, usable via
  Corepack).
- Choices are for this repository; they do not constrain what generated code in
  other languages uses.
