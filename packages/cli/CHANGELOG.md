# @selfauth/cli

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
