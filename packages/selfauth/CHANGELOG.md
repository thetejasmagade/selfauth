# selfauth

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
  - @selfauth/cli@0.5.0

## 0.4.0

### Minor Changes

- bf61fa0: The agent skill now answers questions about SelfAuth, not only performs integrations. It bundles the
  user guides (usage, existing projects, database, deployment, customization, upgrading, limits, API) next
  to the specifications, adds a question-to-answer map, and tells agents to answer from those files, cite
  requirement IDs, separate supported / planned / unsupported, and state that no independent audit has
  been done.

### Patch Changes

- Updated dependencies [bf61fa0]
  - @selfauth/cli@0.4.0

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
  - @selfauth/cli@0.3.0

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
  - @selfauth/cli@0.2.0

## 0.1.0

### Minor Changes

- 28d295e: First public release (0.1.0).
  
  - `selfauth init` (Express + PostgreSQL/Prisma or in-memory, optional Vue or React frontend), `add` for existing Express projects, `detect`, `doctor`, `validate`, `diff`/`upgrade`, `db …`, and `skill install` for coding agents.
  - The specification, configuration schema and requirement tooling (`@selfauth/spec`), migration safety analysis (`@selfauth/migration`), and the conformance suite (`@selfauth/conformance`).
  - `selfauth`: the short name, so `npx selfauth` runs the CLI.

### Patch Changes

- Updated dependencies [28d295e]
  - @selfauth/cli@0.1.0
