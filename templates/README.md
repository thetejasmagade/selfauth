# Templates: copyable SelfAuth projects

Complete, standalone projects for installing SelfAuth **by hand**, with no CLI,
no LLM and no SelfAuth service. Each one is exactly what `selfauth init` or
`selfauth add` would generate. `scripts/sync-templates.mjs` writes them from
the tested reference implementation, and CI fails if they drift
(`pnpm templates:check`). Every file is plain source you can read before you
run it.

| Template | What it is | Start with |
| --- | --- | --- |
| [`express/`](express/) | Express 5 + TypeScript API with PostgreSQL (Prisma). Falls back to an in-memory store when `DATABASE_URL` is unset in development | Its `README.md` |
| [`express-vue/`](express-vue/) | A workspace of two packages: the API in `server/` and a Vue 3 app in `client/` (every auth page, guards, `<Can>`), and a notes example showing ownership checks | Its `README.md` |
| [`express-react/`](express-react/) | The same with React | Its `README.md` |
| [`fastify/`](fastify/) | Fastify 5 + TypeScript API with PostgreSQL (Prisma): the same core and stores as `express/` behind a Fastify adapter | Its `README.md` |
| [`fastify-vue/`](fastify-vue/), [`fastify-react/`](fastify-react/) | The Fastify API in `server/` with a Vue 3 or React app in `client/` | Its `README.md` |
| [`gin/`](gin/) | Gin (Go) API with PostgreSQL (pgx): a Go port of the core, API only. Falls back to an in-memory store when `DATABASE_URL` is unset in development | Its `README.md` |
| [`existing-express/`](existing-express/) | The files to **add** to an existing Express app: `src/selfauth/`, `prisma/` and `selfauth.manifest.json` | [Manual integration](../docs/manual-integration.md#existing-express-app) |

These templates are offered under MIT **or** 0BSD, your choice (ADR 0013). You
don't have to keep a licence notice in your application.

CI copies `express/` outside this repository and runs it with only `npm` and
Prisma: install, typecheck, build, `prisma migrate deploy`, seed, then the
sign-up → verify → login → protected route → logout flow
(`scripts/smoke-generated.sh postgresql manual`).

Keep `selfauth.manifest.json`. It's harmless at runtime, and it lets
`npx selfauth diff` and `upgrade` show you exactly what changed if you later
decide to use the CLI.
