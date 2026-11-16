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

> **Status: pre-alpha.** Spec, conformance suite, Express + PostgreSQL backend,
> Vue/React frontends, a CLI (`init`, `add`, `upgrade`, migrations), and a
> `selfauth` skill for coding agents. See [`ROADMAP.md`](ROADMAP.md).

```bash
node packages/cli/dist/bin.js init my-app --database postgresql   # after pnpm build
node packages/cli/dist/bin.js skill install my-app --agent claude  # let your agent drive it
```

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
├── packages/cli/       The `selfauth` CLI generator (@selfauth/cli)
├── packages/migration/ Migration orchestration + SQL safety analysis (@selfauth/migration)
├── conformance/        Language-neutral conformance cases and runner (@selfauth/conformance)
├── apps/playground/    Express reference implementation (memory or PostgreSQL)
├── apps/playground-vue/   Vue 3 reference frontend
├── apps/playground-react/ React reference frontend
├── apps/e2e/            One Playwright spec run against both frontends
├── docs/adr/           Architecture decision records
├── templates/          Copyable standalone projects (manual install, no CLI)
├── skills/selfauth/    The `selfauth` agent skill (Claude Code, Codex, Cursor)
├── integrations/       How to install the skill for each agent
└── examples/           Sample projects (existing-express-app: skill acceptance)
```

Start with:

- [`docs/`](docs/README.md): install with the CLI, by hand, or with an agent;
  API reference; upgrading
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — components and boundaries
- [`DECISIONS.md`](DECISIONS.md) — why things are the way they are
- [`packages/spec/specs/`](packages/spec/specs/) — what every implementation must do

## Development

Requires Node.js ≥ 22 and pnpm 10 (`corepack enable`). PostgreSQL tests run
when `TEST_DATABASE_URL` is set (CI always runs them).

```bash
pnpm install
pnpm check      # format check, lint, typecheck, tests
pnpm build
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Report vulnerabilities privately as
described in [`SECURITY.md`](SECURITY.md).

## License

MIT for SelfAuth itself. Generated output and templates are additionally
offered under 0BSD, so generated code is yours without attribution
obligations — see [ADR 0013](docs/adr/0013-mit-license.md).
