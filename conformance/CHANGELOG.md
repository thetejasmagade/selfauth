# @selfauth/conformance

## 0.20.0

### Patch Changes

- Updated dependencies [90c8abd]
  - @selfauth/spec@0.20.0

## 0.19.0

### Patch Changes

- @selfauth/spec@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [9a3fb71]
  - @selfauth/spec@0.18.0

## 0.17.0

### Patch Changes

- @selfauth/spec@0.17.0

## 0.16.0

### Patch Changes

- @selfauth/spec@0.16.0

## 0.15.1

### Patch Changes

- @selfauth/spec@0.15.1

## 0.15.0

### Minor Changes

- a109eea: Add a Gin (Go) backend. `selfauth init --backend gin` generates an API-only Go project (PostgreSQL via pgx, or the in-memory store): a Go port of the authentication core behind a Gin adapter, held to the same 90 conformance cases as Express and Fastify on both stores. `doctor`, `validate`, `diff`, `upgrade` and `db` work on it; `add` does not apply to Go. The configuration schema accepts `adapter.backend: "gin"` (with `orm: "none"`) and the manifest records the backend and the Go module path.

### Patch Changes

- Updated dependencies [a109eea]
  - @selfauth/spec@0.15.0

## 0.14.0

### Minor Changes

- cd70f2b: MongoDB is a supported database: `selfauth init --database mongodb` (and `selfauth add --database
  mongodb`) for Express and Fastify, through Mongoose 9.
  
  - Its own store, not derived from SQL (ADR 0026). No transactions: the credential and the role links
    are embedded in the user document so creating a user is one atomic write; tokens, sessions and
    roles use conditional updates; rate limits use compare-and-swap. It works on a standalone server
    and on a replica set. Every lookup key is checked to be a string, so a request cannot smuggle a
    query operator into a filter.
  - Indexes, not migrations: `selfauth db migrate` (or `npm run db:migrate`) creates the missing indexes
    and never drops one; `selfauth db plan` lists them. The unique email index is what keeps accounts
    unique, so the server refuses to start without the indexes.
  - Claimed at authorization level, not production, until its production profile has been reviewed.
  - The conformance run uses a real MongoDB in CI (`scripts/dialect-conformance.mjs mongodb`); the test
    helpers now sit behind `test/database.ts` so another database replaces one file.

### Patch Changes

- Updated dependencies [cd70f2b]
  - @selfauth/spec@0.14.0

## 0.13.0

### Minor Changes

- 351a600: MySQL is a supported database: `selfauth init --database mysql` (and `selfauth add --database mysql`)
  for Express and Fastify, with the same 90 conformance cases passing on a real MySQL 8.
  
  - Prisma 7 with the MariaDB driver adapter (`@prisma/adapter-mariadb`), so it works with MySQL 8 and
    MariaDB. `DATABASE_URL=mysql://user:password@host:3306/db`; create the empty database, then
    `selfauth db migrate`.
  - Derived from the tested PostgreSQL reference at generation time (ADR 0025), like SQLite. Tables use
    the exact-byte `utf8mb4_bin` collation, because MySQL's default ignores case and accents and two
    different emails or rate-limit keys could collide. The rate-limit row lock is an upsert that
    changes nothing plus `SELECT ... FOR UPDATE`, which avoids the deadlock `INSERT IGNORE` causes.
  - `@selfauth/migration`'s SQL safety analysis reads MySQL's backtick-quoted SQL and flags `MODIFY`,
    `CHANGE`, `DROP FOREIGN KEY`, `RENAME TABLE` and `DROP DATABASE`.
  - Claimed at authorization level, not production, until its production profile has been reviewed.

### Patch Changes

- Updated dependencies [351a600]
  - @selfauth/spec@0.13.0

## 0.12.0

### Minor Changes

- 8147603: SQLite is a supported database: `selfauth init --database sqlite` (and `selfauth add --database sqlite`)
  for Express and Fastify, with the same 90 conformance cases passing.
  
  - One file, no server to run. `DATABASE_URL=file:./app.db`; `selfauth db migrate` creates the file.
    Uses Prisma 7 with `better-sqlite3`.
  - Derived from the tested PostgreSQL reference at generation time instead of copied (ADR 0025): the
    schema and the PostgreSQL-specific parts of the store are transformed, the migration is generated
    by Prisma, and CI runs the whole conformance suite, including the concurrent cases, against the
    derived code for both backends.
  - Claimed at authorization level, not production: it is one file on one host, and the production
    profile expects a rate-limit store shared across instances.
  - The configuration schema and the manifest accept `mysql` as a database name (not implemented
    yet; `createAuth()` and `selfauth upgrade` refuse it, as they do MongoDB).
  - `selfauth db status` and `db plan` treat a SQLite file that does not exist yet as "nothing
    applied" instead of failing.

### Patch Changes

- Updated dependencies [8147603]
  - @selfauth/spec@0.12.0

## 0.11.0

### Minor Changes

- 664fcf7: Security fixes from an automated hostile review (see `docs/security-review.md`).
  
  - **Per-account login and password-change rate limits could be bypassed by concurrent requests.**
    The limit was read before the password hash and counted after it, so parallel guesses all passed
    the check (20 of 20 evaluated against a limit of 5). The attempt is now counted atomically before
    the hash and cleared by a verified password. Regenerate or `selfauth upgrade` to get the fix in
    `src/auth/core/service.ts`.
  - On PostgreSQL, a request with a malformed `:id` (for example `DELETE /auth/sessions/not-a-uuid`)
    returned 500; it is now `404 NOT_FOUND`, as with the in-memory store (`src/auth/stores/prisma.ts`).
  - `init` and `add` refuse an app base URL with spaces, control characters or a non-http(s) scheme.
  - The conformance suite grows from 87 to 90 cases: `CT-RATE-006` and `CT-PWCHG-004` (concurrent
    guesses against the limits) and `CT-SESS-006` (malformed session id). The runner's `concurrent`
    step now reports `errorCodes`, so a case can count how many attempts a limit let through.
- eb0cd7c: `selfauth add` now works on existing Fastify projects, and the browser tests run against Fastify.
  
  - `add` and `detect` recognise Fastify (`--backend fastify` overrides when both frameworks are
    dependencies), write the same `<src>/selfauth/` folder and a Fastify `setup.ts`, and print the
    Fastify wiring: `Fastify({ ...selfAuthServerOptions() })`, `await setupSelfAuth(app)`,
    `app.setErrorHandler(selfauth.errorHandler)`. `selfAuthServerOptions()` carries the body limit,
    trusted-proxy setting and request-id rule, which Fastify only accepts when the app is created.
  - The Playwright suite runs the Vue and React frontends against both the Express and the Fastify
    backends (24 tests).
- 2da4e04: `selfauth init` is now an interactive wizard when it runs in a terminal without `--yes`.
  
  - Arrow-key menus (or press a number) for backend, database and frontend, each with a one-line
    hint, instead of typing a word and finding out about a typo later.
  - It also asks for the project folder, your application permissions, where your frontend runs
    (API-only projects) and whether to run `npm install`.
  - A bad answer is explained and asked again at once; flag values are checked before anything is
    asked; Ctrl-C cancels with exit code 130 and writes nothing.
  - Flags still answer their question in advance. With `--yes`, or without a terminal, nothing is
    asked, exactly as before.
- 6a2bc93: Full-stack projects no longer ship the notes demo. `init --frontend vue|react` now generates the
  five account screens, the account page and the guards, and the API has the same single protected
  example route as an API-only project. The demo's permissions (`notes.*`) and the `support` role are
  not added to `selfauth.config.ts`, and the nav bar has no demo link.
  
  The reference apps keep the notes example for the browser tests; generation removes it with exact
  replacements and fails loudly if a reference file changes. Existing projects are not touched:
  `selfauth upgrade` reports the notes files as removed from the template and leaves them alone.

### Patch Changes

- Updated dependencies [664fcf7]
- Updated dependencies [eb0cd7c]
- Updated dependencies [2da4e04]
- Updated dependencies [6a2bc93]
  - @selfauth/spec@0.11.0

## 0.10.0

### Minor Changes

- 9dc30ee: The Vue and React starter pages are now plain, unstyled HTML. The stylesheet (`web/src/style.css`, or `client/src/style.css`) and the styling-only class names are gone, so you can bring your own design system without undoing ours. The semantic markup is unchanged (labels, `role="alert"`, `autocomplete`, password inputs).

### Patch Changes

- Updated dependencies [9dc30ee]
  - @selfauth/spec@0.10.0

## 0.9.0

### Minor Changes

- f66dcce: Fastify is a second backend: `selfauth init --backend fastify` (API only, or full-stack with a Vue or React client) generates a Fastify 5 project with the same core, stores, tests and frontends as the Express one, behind a Fastify adapter in `src/auth/fastify/`. All 87 conformance cases pass on it with the in-memory store and with PostgreSQL; it is published at the authorization level (production-profile review is pending). The configuration schema accepts `adapter.backend: "fastify"`, the manifest records `options.backend`, `upgrade`/`doctor`/`validate` work on Fastify projects, and there are manual templates `fastify/`, `fastify-vue/` and `fastify-react/`. `selfauth add` (existing projects) still supports Express only; `detect` and `add` point Fastify apps to `init --backend fastify`. The generated Fastify server listens on `HOST` (default `0.0.0.0`).

### Patch Changes

- Updated dependencies [f66dcce]
  - @selfauth/spec@0.9.0

## 0.8.1

### Patch Changes

- 71cdbb1: Docs: list the three frontend pages to edit when you change the password length.
- 5ee63a8: Reverts the shared root `selfauth.config.json` added in 0.8.0. The password length is set again in the server's `selfauth.config.ts` only, and generated projects no longer have the root file, `scripts/sync-config.mjs`, the `sync`/`pre*` scripts or the copies in `server/` and `client/`. The frontend's register, reset and account pages go back to a fixed `minlength` hint, and the docs now list the three pages to edit when you change the password length. Projects made with 0.8.0 can delete the root `selfauth.config.json`, `scripts/` and the copies, and the `sync` and `pre*` scripts, though leaving them does no harm.
- Updated dependencies [71cdbb1]
- Updated dependencies [5ee63a8]
  - @selfauth/spec@0.8.1

## 0.8.0

### Minor Changes

- f1e6cc1: Full-stack projects get one root `selfauth.config.json` for the settings the browser needs too (the password length limits). Edit it once: the server's config and the frontend's register, reset and account screens both read it, so the form can no longer disagree with the server. Each package imports a copy inside its own folder, written by `npm run sync` (run automatically before `dev`, `build`, `test` and `typecheck`), so the build, tsconfig and Vite are unchanged. `selfauth doctor` warns when a copy is stale. Existing projects keep working; `selfauth upgrade` adds the frontend's copy.

### Patch Changes

- Updated dependencies [f1e6cc1]
  - @selfauth/spec@0.8.0

## 0.7.0

### Minor Changes

- 7dbea79: The default minimum password length is now 8 (was 12). 8 is the floor the specification allows
  (SEC-PWPOLICY-001), and common-password rejection stays on by default. Projects set it in
  `selfauth.config.ts` (`authentication.password.minLength`, up to 1024); existing projects keep the value
  in their own config. The generated frontends' hint and `minlength` attribute follow the default,
  conformance case CT-REG-005 now checks the boundary at 8 (7 rejected, 8 accepted), and `selfauth doctor` no
  longer warns about every project for having a minimum below 12.

### Patch Changes

- 19eb350: `selfauth db` now explains a missing `DATABASE_URL` instead of ending in Prisma's bare "Connection url is
  empty". It reads the environment and the project's `.env` itself (tolerating CRLF line endings, a byte-order
  mark and quotes), hands the value to Prisma explicitly, ignores an empty shell variable that would hide
  `.env`, and reports what it found, where it looked, and when the value is the `.env.example` placeholder
  or not a PostgreSQL URL. The database guide gains a troubleshooting section (URL-encoding passwords, and
  using a direct or session-mode connection for migrations on Supabase and other pooled databases).
- Updated dependencies [19eb350]
- Updated dependencies [7dbea79]
  - @selfauth/spec@0.7.0

## 0.6.0

### Minor Changes

- 21d7f85: Full-stack projects are now two real packages. `selfauth init --frontend vue|react` makes `server/` (the
  Express API: its own `package.json`, `tsconfig`, `.env.example`, `src/`, `test/`, `prisma/`) and `client/`
  (the Vue or React app) in one npm workspace, with a thin root: `package.json` (`npm run dev` starts both,
  one `npm install` installs both), `README.md` and `.gitignore`. API-only projects are unchanged.
  
  - Each package has its own `selfauth.manifest.json`. `doctor`, `validate`, `diff` and `upgrade` run at the
    workspace root over both packages, or inside either package; `db` finds the server from anywhere.
  - `selfauth upgrade --reorganize` also moves an existing full-stack project (made with 0.5 or earlier)
    into this layout: whole folders move, `package.json` and the manifest are split, the root is created,
    and your own files, `.env`, scripts and dependencies come along. Round-trip tests restore exactly what
    `init` writes.
  - Prisma is found in a parent folder (npm hoists it to the workspace root), and `detect` no longer flags
    SelfAuth's own files in a workspace as foreign authentication code.
  - The ownership manifest gains the `server` and `client` layouts and `structure: 3`.

### Patch Changes

- d526c8a: `selfauth db …` now works on Windows. It ran Prisma through `node_modules/.bin/prisma`, a shell script that
  Windows cannot execute, so `selfauth db plan` failed with an empty message (`prisma migrate status
  failed:`). The CLI now starts Prisma's entry script with Node, which works everywhere, finds Prisma in a
  parent folder (npm workspaces hoist it), and says what is wrong when Prisma is not installed or the
  process cannot start, instead of an empty message.
- Updated dependencies [21d7f85]
- Updated dependencies [d526c8a]
  - @selfauth/spec@0.6.0

## 0.5.0

### Minor Changes

- 4df71a2: Generated projects now have a proper folder structure. The app files that used to sit side by side in
  `src/` are grouped by responsibility: `src/config/` (selfauth.config.ts, env.ts, dev-config.ts),
  `src/email/mailer.ts`, `src/db/store.ts`, `src/http/` (errors, request-id) and `src/routes/`. In `web/`,
  the five SelfAuth screens (login, register, verify email, forgot and reset password) moved to
  `src/pages/auth/`, leaving `src/pages/` for the app's own pages. The generated README shows the layout. `selfauth add` uses the same grouping under `<src>/selfauth/`.
  
  Projects made with 0.3 or earlier keep working with `doctor` and `validate`. `selfauth upgrade
  --reorganize` moves them to the new layout (moves the files, rewrites the relative imports, updates the
  manifest, including `web/` pages); a round-trip test proves it restores exactly what a new project has. `upgrade` itself asks
  you to run it first, because the new templates import each other from the new places.
  
  The ownership manifest records `options.structure`.

### Patch Changes

- Updated dependencies [4df71a2]
  - @selfauth/spec@0.5.0

## 0.4.0

### Minor Changes

- bf61fa0: The agent skill now answers questions about SelfAuth, not only performs integrations. It bundles the
  user guides (usage, existing projects, database, deployment, customization, upgrading, limits, API) next
  to the specifications, adds a question-to-answer map, and tells agents to answer from those files, cite
  requirement IDs, separate supported / planned / unsupported, and state that no independent audit has
  been done.

### Patch Changes

- Updated dependencies [bf61fa0]
  - @selfauth/spec@0.4.0

## 0.3.0

### Minor Changes

- a649786: Existing projects in any layout.
  
  - `selfauth add --src <folder>`: write under `<folder>/selfauth/` when the code is not in `src/`. Without
    it, `add` finds the folder from the Express entry file. It refuses, before writing, when `tsconfig.json`
    would not compile the new folder.
  - `selfauth add-frontend`: adds the authentication module (client, session state, route guards, `<Can>`)
    to an existing Vue or React app, in any folder or repository. It writes new files only, with its own
    manifest, and generates no pages. `validate`, `doctor`, `diff` and `upgrade` work in that folder.
  - `selfauth detect` reports the source folder, the Express entry file, monorepo packages and frontends,
    with the command to run in each. The agent skill gained a project-layouts reference.
  - The ownership manifest records `srcDir` and the new `frontend` layout.

### Patch Changes

- Updated dependencies [a649786]
  - @selfauth/spec@0.3.0

## 0.2.0

### Minor Changes

- 7364ff3: Conformance levels and quality gates.
  
  - `@selfauth/conformance`: `runSuite`, `evaluateLevels` and the adapter record (compliance levels with
    evidence-backed sign-offs), requirement areas, and a generated support-matrix document.
  - `selfauth init` projects now include a smoke test suite (`npm test`, Node's built-in runner, no extra
    dependencies) that exercises the project's own authentication wiring.
  - The Express adapter refuses configuration it cannot honour (for example MongoDB), at start-up.
  - Documentation: data retention after account deletion, security review, HTTPS and HSTS.

### Patch Changes

- Updated dependencies [7364ff3]
  - @selfauth/spec@0.2.0

## 0.1.0

### Minor Changes

- 28d295e: First public release (0.1.0).
  
  - `selfauth init` (Express + PostgreSQL/Prisma or in-memory, optional Vue or React frontend), `add` for existing Express projects, `detect`, `doctor`, `validate`, `diff`/`upgrade`, `db …`, and `skill install` for coding agents.
  - The specification, configuration schema and requirement tooling (`@selfauth/spec`), migration safety analysis (`@selfauth/migration`), and the conformance suite (`@selfauth/conformance`).
  - `selfauth`: the short name, so `npx selfauth` runs the CLI.

### Patch Changes

- Updated dependencies [28d295e]
  - @selfauth/spec@0.1.0
