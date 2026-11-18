# SelfAuth architecture

SelfAuth is a **development-time** code-generation and integration toolkit. It
never runs as part of the application it helps build.

## Components

```text
                ┌───────────────────────── SelfAuth repository ─────────────────────────┐
                │                                                                        │
                │  Core specification ──► Conformance suite ◄── verifies ── Adapters     │
                │  (packages/spec)        (conformance/)                    (packages/   │
                │        │                                                   adapters/)  │
                │        ▼                                                      ▲        │
                │  CLI (packages/cli) ── detects project, plans, renders ───────┘        │
                │        ▲                       templates, calls native tools           │
                │        │                                                               │
                │  LLM skills (skills/) ── instruct agents to use the CLI                │
                └────────┼───────────────────────────────────────────────────────────────┘
                         │ development time only
                         ▼
                ┌──────── Application repository (owned by the developer) ───────┐
                │  generated source · schema · migrations · selfauth.manifest   │
                │  runs with the app's own framework, ORM, DB, email provider   │
                └────────────────────────────────────────────────────────────────┘
```

| # | Component | Location | Status |
| --- | --- | --- | --- |
| 1 | **Core specification** — requirements, data contracts, security rules, error codes, configuration | `packages/spec` | Draft 0.1 |
| 2 | **Conformance suite** — language-neutral cases, coverage enforcement, and an executable runner with a driver contract | `conformance` | 90 cases, runner |
| 3 | **Framework adapters** — Express backend plus Vue 3 and React frontend reference implementations (application-owned code, the future template source) | `apps/playground*/src/auth` | Express: 90/90 cases on memory and PostgreSQL; Vue and React: unit tests + one shared browser spec |
| 4 | **Database & migration adapters** — stores per database; migration contract + SQL safety analysis + Prisma Migrate adapter | `apps/playground/src/auth/stores`, `packages/migration` | PostgreSQL/Prisma: 90/90 cases; MongoDB later |
| 5 | **CLI** — `init` (backend + optional Vue/React), `add`, `diff`, `upgrade`, `doctor`, `validate`, `db *` | `packages/cli` | Generated and added projects smoke-tested in CI |
| 6 | **LLM skills** — `selfauth` skill for Claude Code and compatible agents | `skills/selfauth` | Phase 7 |

Packages that do not exist yet are deliberately not scaffolded as empty
directories; they are created by the phase that implements them.

## Dependency boundaries

```text
@selfauth/spec            (no internal dependencies)
   ▲
@selfauth/conformance     depends on spec
   ▲
adapters / migration      depend on spec (+ conformance in tests only)
   ▲
@selfauth/cli             depends on adapters, migration, spec
```

Rules:

- `spec` stays language-neutral in its Markdown. Its TypeScript exports are
  *tooling* (requirement parsing, configuration schema), not runtime auth code.
- Framework-specific behavior lives only in adapters.
- No package may introduce a runtime network dependency for generated
  applications (ADR 0002).
- `apps/*` and `examples/*` are private and never published.

## The ownership boundary

The SelfAuth repository owns the generator, specifications, templates, skills,
documentation, and tests. The application developer owns all generated code,
data, configuration, migrations, and runtime behavior. Generated code must keep
working if the SelfAuth repository, CLI, npm registry, or any LLM service is
unavailable.

## Out of scope (initial product)

Hosted identity provider or central auth server; hosted user database or
dashboard; mandatory runtime SDK or network dependency; SSO across separately
deployed applications; billing; every framework in the first release; custom
cryptography.

## Request flow of a generated backend (target design, Phase 3)

```text
HTTP request
  → cookie parsing → CSRF check (unsafe methods) → rate limiter (auth routes)
  → session middleware: hash(token) lookup → expiry/revocation check → req.auth
  → route handler
      → requireAuth / requirePermission(p) / authorize(subject, action, resource)
      → auth services (registration, login, reset, …) — framework-independent
          → repositories (Prisma / Mongoose adapter)
          → mailer (application-provided adapter)
          → security event sink
```
