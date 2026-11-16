# @selfauth/cli

Generate project-local authentication you own. The CLI writes code into your
project and then gets out of the way: nothing it generates calls SelfAuth at
runtime.

```bash
npx selfauth init my-app --database postgresql --permissions orders.view,orders.create
cd my-app && npm install && cp .env.example .env   # set DATABASE_URL
npx selfauth db plan        # review the migration (destructive / non-owned changes are flagged)
npx selfauth db migrate     # applies via Prisma Migrate; refuses destructive plans unless approved
npm run db:seed && npm run dev
```

## Commands

| Command | What it does |
| --- | --- |
| `init [dir]` | New Express project: `--database postgresql\|memory`, `--permissions`, `--app-base-url`, `--dry-run`, `--yes`, `--install`. Shows the plan, never overwrites a file. |
| `list` | Supported integrations |
| `doctor [dir]` | Configuration and production-readiness checks (enumeration opt-ins, insecure cookies, missing mail provider, secrets hygiene, `.env`) |
| `validate [dir]` | Config schema, generated-file integrity (which files you changed), Prisma schema vs. ownership manifest |
| `db status\|plan\|migrate\|validate\|rollback` | Migration orchestration over the native tool ([`@selfauth/migration`](../migration)) |
| `db generate <name>` | New migration from `schema.prisma` changes, not applied |

## What you get

A TypeScript Express app with registration, email verification, login,
sessions, logout everywhere, password change/reset, account deletion, RBAC,
resource policies, CSRF/CORS, rate limiting, audit events and log redaction.
The files are the SelfAuth reference implementation — the code that passes
the 87-case conformance suite — copied byte for byte (ADR 0018). Edit them
freely: `selfauth.manifest.json` records what was generated, so your changes
are detected and never overwritten.

Coming next: Vue/React frontends, `add` for existing projects, `diff`/`upgrade`.
