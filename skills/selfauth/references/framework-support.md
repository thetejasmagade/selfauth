# Framework support

This list matches `selfauth list --json`, and a test keeps the two in sync.
Anything not listed here is **unsupported**. Don't write an adapter, port the
Express code, or "adapt" the generated files to another framework. Tell the
developer instead.

## Supported

| Kind | ID | Notes | `init` | `add` |
| --- | --- | --- | --- | --- |
| backend | `express` | Express 5 + TypeScript ≥ 5.7, ESM (`"type": "module"`), Node.js ≥ 22.18 | ✓ | ✓ |
| backend | `fastify` | Fastify 5 + TypeScript, same core and stores as Express (`selfauth init --backend fastify`). All 87 conformance cases pass on both stores; published at authorization level, production-profile review pending. `add` works on an existing Fastify app | ✓ | ✓ |
| database | `postgresql` | PostgreSQL via Prisma 7. Committed, reviewable migrations | ✓ | ✓ (only if the project has no Prisma schema yet) |
| database | `memory` | In-memory store. For trying SelfAuth out, not for production: refuses to start with `NODE_ENV=production` | ✓ | ✓ |
| frontend | `none` | API only | ✓ | ✓ |
| frontend | `vue` | Vue 3 + Vite in `web/`. For an existing app, `selfauth add-frontend` adds only the auth module (`src/selfauth/`) | ✓ | ✓ (`add-frontend`) |
| frontend | `react` | React + Vite in `web/`. For an existing app, `selfauth add-frontend` adds only the auth module (`src/selfauth/`) | ✓ | ✓ (`add-frontend`) |

`selfauth add-frontend` works on Vue and React apps only, and generates no
pages: the developer builds their own with the client. Any other frontend works
if it sends cookies and the CSRF header (see
[architecture](architecture.md#frontend)); wire it by hand. Where the code lives
(a folder other than `src/`, a monorepo, a frontend in another repository) is
covered in [project layouts](project-layouts.md).

## Planned, not available yet

- MongoDB + Mongoose.
- Prisma schema merging for `selfauth add`. Projects that already use Prisma
  can use `--database memory` now, or copy the models from a project made with
  `selfauth init --database postgresql` by hand, with the developer, as a
  reviewed migration.

## Not supported (examples)

Koa, Hapi, NestJS, Hono, Next.js API routes, Nuxt server routes,
SvelteKit, Remix and AdonisJS. Non-JavaScript backends: Python, Go, Ruby, PHP,
Java and Rust. Databases: MySQL, SQLite, MongoDB, and ORMs other than Prisma
(TypeORM, Sequelize, Drizzle, Knex, MikroORM). Authentication methods: OAuth,
social login, magic links, passkeys, MFA and JWT access tokens. The
specification describes some of these as optional capabilities. The
generator does not produce them yet.

When the stack is unsupported, report:

1. what you detected (`selfauth detect`);
2. that SelfAuth has no generator for it;
3. the closest supported option, if one is realistic, such as a separate
   Express auth service. Only suggest it; never build it unasked.
