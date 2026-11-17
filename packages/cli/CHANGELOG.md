# @selfauth/cli

## 0.8.0

### Minor Changes

- f1e6cc1: Full-stack projects get one root `selfauth.config.json` for the settings the browser needs too (the password length limits). Edit it once: the server's config and the frontend's register, reset and account screens both read it, so the form can no longer disagree with the server. Each package imports a copy inside its own folder, written by `npm run sync` (run automatically before `dev`, `build`, `test` and `typecheck`), so the build, tsconfig and Vite are unchanged. `selfauth doctor` warns when a copy is stale. Existing projects keep working; `selfauth upgrade` adds the frontend's copy.

### Patch Changes

- Updated dependencies [f1e6cc1]
  - @selfauth/spec@0.8.0
  - @selfauth/migration@0.8.0

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
  - @selfauth/migration@0.7.0
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
  - @selfauth/migration@0.6.0
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
  - @selfauth/migration@0.5.0
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
  - @selfauth/migration@0.4.0

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
  - @selfauth/migration@0.3.0
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
  - @selfauth/migration@0.2.0

## 0.1.0

### Minor Changes

- 28d295e: First public release (0.1.0).
  
  - `selfauth init` (Express + PostgreSQL/Prisma or in-memory, optional Vue or React frontend), `add` for existing Express projects, `detect`, `doctor`, `validate`, `diff`/`upgrade`, `db …`, and `skill install` for coding agents.
  - The specification, configuration schema and requirement tooling (`@selfauth/spec`), migration safety analysis (`@selfauth/migration`), and the conformance suite (`@selfauth/conformance`).
  - `selfauth`: the short name, so `npx selfauth` runs the CLI.

### Patch Changes

- Updated dependencies [28d295e]
  - @selfauth/spec@0.1.0
  - @selfauth/migration@0.1.0
