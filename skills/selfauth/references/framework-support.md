# Framework support

This list matches `selfauth list --json`, and a test keeps the two in sync.
Anything not listed here is **unsupported**. Don't write an adapter, port the
Express code, or "adapt" the generated files to another framework. Tell the
developer instead.

## Supported

| Kind | ID | Notes | `init` | `add` |
| --- | --- | --- | --- | --- |
| backend | `express` | Express 5 + TypeScript ≥ 5.7, ESM (`"type": "module"`), Node.js ≥ 22.18 | ✓ | ✓ |
| backend | `fastify` | Fastify 5 + TypeScript, same core and stores as Express (`selfauth init --backend fastify`). All 90 conformance cases pass on both stores; published at authorization level, production-profile review pending. `add` works on an existing Fastify app | ✓ | ✓ |
| backend | `gin` | Gin (Go): a Go port of the core (`selfauth init --backend gin`). Every database (PostgreSQL via pgx, MySQL and SQLite via `database/sql`, MongoDB via the official driver, or in-memory), with or without a Vue or React frontend (`server/` + `client/`); the CLI composes the project from the parts you choose, there are no per-combination templates. New projects only (`add` does not apply to Go). All 90 conformance cases pass on every store; published at authorization level. Needs Go 1.26+ | ✓ | ✗ |
| backend | `flask` | Flask (Python): a Python port of the core (`selfauth init --backend flask`). Every database (PostgreSQL via psycopg, MySQL via PyMySQL, SQLite via `sqlite3`, MongoDB via PyMongo, or in-memory), with or without a Vue or React frontend (`server/` + `client/`); composed by the CLI like Gin, no per-combination templates. New projects only (`add` does not apply to Python). All 90 conformance cases pass on every store; published at authorization level. Needs Python 3.11+ | ✓ | ✗ |
| backend | `next` | Next.js 16 (App Router route handlers): the TypeScript core behind `app/auth/[[...path]]/route.ts` and `withAuth`-built handlers under `app/api/` (`selfauth init --backend next`). Every database (PostgreSQL, MySQL, SQLite via Prisma; MongoDB via Mongoose; or in-memory). Alone (API only), with `--frontend next` (pages and API in one app, one package), or with a Vue or React frontend (`server/` + `client/`). New projects only (`add` does not apply to Next.js apps). All 90 conformance cases pass on every store; published at authorization level. The client address comes from `X-Forwarded-For`: set `http.trustProxy` to the number of proxies in front of the app | ✓ | ✗ |
| database | `postgresql` | PostgreSQL via Prisma 7 (pgx for Gin). Committed, reviewable migrations | ✓ | ✓ (only if the project has no Prisma schema yet) |
| database | `mysql` | MySQL 8 (or MariaDB) via Prisma 7 (`@prisma/adapter-mariadb`). Derived from the PostgreSQL reference at generation time; all 90 conformance cases pass on a real MySQL 8; claimed at authorization level until the production profile is reviewed. `DATABASE_URL=mysql://user:password@host:3306/db` (create the empty database first) | ✓ | ✓ (only if the project has no Prisma schema yet) |
| database | `mongodb` | MongoDB 6+ via Mongoose 9. Its own store (not derived from SQL): the credential and the role links are embedded in the user document, so creating a user is one atomic write; no transactions are used. Indexes (the unique email index above all) are created by `selfauth db migrate` / `npm run db:migrate`, never at start-up, and start-up refuses to run without them. All 90 conformance cases pass; claimed at authorization level. `DATABASE_URL=mongodb://host:27017/db` | ✓ | ✓ |
| database | `sqlite` | SQLite via Prisma 7 (`better-sqlite3`): one file on one host, no server. Derived from the PostgreSQL reference at generation time; all 90 conformance cases pass; claimed at authorization level, not production (no rate-limit store shared across machines). `DATABASE_URL=file:./app.db`; `selfauth db migrate` creates the file | ✓ | ✓ (only if the project has no Prisma schema yet) |
| database | `memory` | In-memory store. For trying SelfAuth out, not for production: refuses to start with `NODE_ENV=production` | ✓ | ✓ |
| frontend | `none` | API only | ✓ | ✓ |
| frontend | `vue` | Vue 3 + Vite in `web/`. For an existing app, `selfauth add-frontend` adds only the auth module (`src/selfauth/`) | ✓ | ✓ (`add-frontend`) |
| frontend | `react` | React + Vite in `web/`. For an existing app, `selfauth add-frontend` adds only the auth module (`src/selfauth/`) | ✓ | ✓ (`add-frontend`) |
| frontend | `next` | Next.js 16 (App Router) with the same auth module, route guards and account screens as the other frontends. With `--backend next` it is the same app as the API (one package); with `express`, `fastify`, `gin` or `flask` it is a Next.js app in `client/` whose `src/proxy.ts` forwards `/auth` and `/api` to the backend (`SELFAUTH_API_TARGET`, read at run time). Browser-tested against every backend. New projects only (`add-frontend` is for Vue and React) | ✓ | ✗ |

`selfauth add-frontend` works on Vue and React apps only, and generates no
pages: the developer builds their own with the client. Any other frontend works
if it sends cookies and the CSRF header (see
[architecture](architecture.md#frontend)); wire it by hand. Where the code lives
(a folder other than `src/`, a monorepo, a frontend in another repository) is
covered in [project layouts](project-layouts.md).

## Planned, not available yet

- Prisma schema merging for `selfauth add`. Projects that already use Prisma
  can use `--database memory` now, or copy the models from a project made with
  `selfauth init --database postgresql` by hand, with the developer, as a
  reviewed migration.

## Not supported (examples)

Koa, Hapi, NestJS, Hono, Nuxt server routes,
SvelteKit, Remix and AdonisJS, and adding SelfAuth to an existing Next.js app
(new Next.js projects are supported). Other languages: Ruby, PHP,
Java and Rust. Databases other than PostgreSQL, MySQL, SQLite and MongoDB, and ORMs
other than Prisma and Mongoose (TypeORM, Sequelize, Drizzle, Knex, MikroORM). Authentication methods: OAuth,
social login, magic links, passkeys, MFA and JWT access tokens. The
specification describes some of these as optional capabilities. The
generator does not produce them yet.

When the stack is unsupported, report:

1. what you detected (`selfauth detect`);
2. that SelfAuth has no generator for it;
3. the closest supported option, if one is realistic, such as a separate
   Express auth service. Only suggest it; never build it unasked.
