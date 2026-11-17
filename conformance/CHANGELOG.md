# @selfauth/conformance

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
