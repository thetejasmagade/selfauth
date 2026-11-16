# ADR 0019 — Adding SelfAuth to existing projects

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

`selfauth add` integrates into code the developer already owns. The plan
requires: detect before acting, ask before conflicting changes, avoid broad
text replacement in application files, and never overwrite.

## Decision

1. **New files only.** Everything goes under `src/selfauth/` (and `prisma/`
   for PostgreSQL), plus `selfauth.manifest.json`. The project's own files —
   including `package.json`, `tsconfig.json`, `.gitignore` and the server —
   are never edited. The CLI prints the exact changes instead: dependency
   install commands (run only with `--install`), missing `compilerOptions`,
   and two lines to wire `setupSelfAuth(app)` and its error handler.
2. **Preflight refuses rather than guesses.** It requires an ESM project,
   Express, TypeScript ≥ 5.7 and an ES module target, and reads the effective
   `tsconfig` through the project's own TypeScript when installed (so
   `extends` is followed). Other auth libraries require
   `--allow-existing-auth`.
3. **No Prisma schema merging yet.** A project that already uses Prisma is
   refused for `--database postgresql`; merging models into someone else's
   schema is a separate, reviewed feature.
4. **The same templates.** `add` copies the reference files verbatim
   (ADR 0018), minus the app shell, plus a small `setup.ts`. The only content
   change is Prisma's generator output path. The manifest records
   `layout: "add"`, so `doctor`, `validate`, `diff` and `upgrade` find files
   at their moved paths.
5. **CSRF covers the whole app.** Session and CSRF middleware are mounted
   app-wide so `requireAuth` works on the app's routes; the printed
   instructions state that browsers must send the CSRF header.

## Consequences

- Integration is reviewable: the diff to the app's own code is the handful of
  lines the developer types.
- The CI smoke test builds a separate existing app, runs `add --install`,
  applies the printed instructions, and verifies both SelfAuth's flows and the
  app's untouched routes.
