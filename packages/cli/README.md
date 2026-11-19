# @selfauth/cli

Generate project-local authentication you own. The CLI writes code into your
project and then gets out of the way: nothing it generates calls SelfAuth at
runtime.

## New project

Run `npx selfauth init` with no flags in a terminal and it asks: the folder, the backend,
the database, the frontend and your permissions (arrow keys, or a number; a bad answer is
explained and asked again; Ctrl-C cancels and writes nothing). It shows the list of files and
asks before it writes anything. Every flag below answers its question in advance, so you only
see what you left out. With `--yes`, or when there is no terminal (CI, scripts, coding agents),
it asks nothing and uses the defaults for whatever the flags leave out.

```bash
npx selfauth init my-app --database postgresql --frontend vue --permissions orders.view
cd my-app && npm install                  # one install covers server/ and client/
cp server/.env.example server/.env        # set DATABASE_URL
npx selfauth db plan        # review the migration
npx selfauth db migrate     # Prisma Migrate; destructive plans need --approve-destructive
npm run db:seed
npm run dev                 # the API (:3000) and the Vue app (:5173) together
```

`--frontend vue|react` makes a full-stack project of two packages in one npm
workspace: the API in `server/` and the reference frontend in `client/` (API
client, session state, route guards, `<Can>`, every auth page). Each package has its
own `selfauth.manifest.json`; run `selfauth doctor`, `validate`, `diff` or `upgrade`
at the root and it covers both. Without a frontend the project is a single package
with `src/` at the root.

## Fastify

`npx selfauth init my-app --backend fastify --database postgresql` makes the same
project on Fastify 5: the same core, stores, tests and frontends, with a Fastify
adapter in `src/auth/fastify/`. `add` works on an existing Fastify project too.

## Gin (Go)

`npx selfauth init my-app --backend gin --database postgresql --module github.com/you/my-app`
makes a Go project: a port of the same core behind a Gin adapter, with a PostgreSQL store (pgx) or the
in-memory store. It is API only (no generated frontend) and for new projects (`add` does not apply
to Go). The files are plain Go source: `cmd/server`, `internal/auth` (the core), `internal/ginauth`
(the adapter), `internal/store/{memory,postgres}`, your `internal/routes` and `internal/email`, and
`selfauth.config.json`. Migrations are SQL files in `db/migrations`, applied with
`go run ./cmd/migrate up` or `npx selfauth db migrate`. Go 1.26 or newer is needed. `doctor`,
`validate`, `diff` and `upgrade` work as for the other backends.

## Existing Express or Fastify project

```bash
npx selfauth add --database memory --install
```

Writes new files under `src/selfauth/` only (or `<folder>/selfauth/` when your
code lives elsewhere: `add` finds the folder from your `express()` entry file,
or you pass `--src server`) and prints the remaining steps: `tsconfig` options
to add, and two lines to wire into your server:

```ts
const selfauth = await setupSelfAuth(app);   // before your routes
app.use(selfauth.errorHandler);              // after your routes
```

Requires ESM, Express and TypeScript ≥ 5.7. Projects that already use Prisma
can use `--database memory` for now (ADR 0019).

## Keeping generated code up to date

```bash
npx selfauth diff        # what a newer CLI's templates would change, with diffs
npx selfauth upgrade     # apply safe changes
```

Files you never edited are updated. Files you edited stay yours: when the
template also changed, a `file.selfauth-new` proposal is written next to it
for you to merge. Files you deleted stay deleted (ADR 0004).

Monorepo, a folder other than `src/`, or a frontend in another folder or
repository (`selfauth add-frontend` for Vue and React):
[Adding SelfAuth to an existing project](https://github.com/thetejasmagade/selfauth/blob/main/docs/existing-projects.md).

## All commands

| Command | What it does |
| --- | --- |
| `init [dir]` | New project: `--backend express\|fastify\|gin`, `--module <go module>` (Gin), `--database postgresql\|mysql\|sqlite\|mongodb\|memory`, `--frontend none\|vue\|react`, `--permissions`, `--app-base-url`, `--dry-run`, `--yes`, `--install` |
| `add [dir]` | Existing Express project: same options plus `--src <folder>` and `--allow-existing-auth` |
| `add-frontend [dir]` | Existing Vue or React app: adds the authentication module under `src/selfauth/` (`--frontend`, `--src`, `--dry-run`, `--yes`, `--install`); generates no pages |
| `detect [dir]` | Read-only inspection: stack, source folder, monorepo packages, database, existing auth (packages and source), which command applies and what blocks it |
| `list` | Supported integrations |
| `doctor [dir]` | Configuration and production-readiness checks |
| `validate [dir]` | Config schema, which generated files you changed, Prisma schema vs. manifest |
| `skill install [dir]` | The `selfauth` agent skill: `--agent claude\|codex\|cursor\|all`, `--global` (install for every project), `--update`, `--dry-run` |
| `diff [dir]` / `upgrade [dir]` | Compare with / update to this CLI's templates. `upgrade --reorganize` moves a project made with 0.3 or earlier into the grouped `src/` layout |
| `db status\|plan\|migrate\|validate\|rollback\|generate` | Migration orchestration over Prisma Migrate |

`detect`, `list`, `doctor` and `validate` take `--json` for agents and scripts.

## Coding agents

```bash
npx selfauth skill install --agent claude   # or codex, cursor, all
npx selfauth skill install --global --agent claude   # for every project, in your home folder
```

This installs the `selfauth` skill, which makes the agent use these commands
instead of writing authentication code. Before it reports success, the agent
must validate the result. See [`integrations/`](../../integrations/README.md).

Generated code is the SelfAuth reference implementation — what passes the
90-case conformance suite and the browser tests — copied byte for byte
(ADR 0018).
