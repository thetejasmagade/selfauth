# SelfAuth

**Authentication. Fully yours.**

SelfAuth is an open-source, **development-time** authentication and
authorization toolkit. It generates, integrates, validates, and maintains
authentication code *inside your own application* — your repository, your
database, your infrastructure.

> Generate it. Own it. Modify it. Deploy it.

SelfAuth is **not** a hosted identity provider, auth server, or runtime SDK.
Code it generates keeps working if SelfAuth, its CLI, npm, or any AI service
disappears.

> **Status: pre-alpha (Sprint 1).** The specification and repository foundation
> exist; no generator or adapter is usable yet. See [`ROADMAP.md`](ROADMAP.md).

## Principles

1. **Developer ownership** — generated code and migrations live in your repo.
2. **No mandatory runtime service** — nothing phones home.
3. **No hidden database changes** — migrations are generated and reviewed.
4. **Native tooling** — your framework, ORM, migration tool, and vetted crypto
   libraries.
5. **Specification-driven** — a language-neutral spec defines behavior; adapters
   implement it and prove it with a conformance suite.
6. **AI is optional** — the CLI and generated code work without an LLM.
7. **Safe upgrades** — never silently overwrite your changes.
8. **Security first** — behavior is tested, not merely generated.

## Repository layout

```text
selfauth/
├── packages/spec/      Normative specification + requirement tooling (@selfauth/spec)
├── conformance/        Language-neutral conformance cases (@selfauth/conformance)
├── apps/playground/    Minimal Express app the reference implementation grows from
├── docs/adr/           Architecture decision records
├── templates/          (Phase 6/8) Application-owned code templates
├── skills/             (Phase 7) Agent skills
├── integrations/       (Phase 7) Agent-tool integrations
└── examples/           (Phase 3+) Example applications
```

Start with:

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — components and boundaries
- [`DECISIONS.md`](DECISIONS.md) — why things are the way they are
- [`packages/spec/specs/`](packages/spec/specs/) — what every implementation must do

## Development

Requires Node.js ≥ 22 and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm check      # format check, lint, typecheck, tests
pnpm build
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Report vulnerabilities privately as
described in [`SECURITY.md`](SECURITY.md).

## License

Apache-2.0 for SelfAuth itself. Generated output and templates are additionally
offered under 0BSD, so generated code is yours without attribution
obligations — see [ADR 0010](docs/adr/0010-license.md).
