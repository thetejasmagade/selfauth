# ADR 0021 — Distribution: published dev tools, generated templates, no runtime package

- **Status:** Accepted (refines ADR 0003)
- **Date:** 2026-11-16

## Context

Phase 8 makes SelfAuth usable without AI or the CLI. It has to publish npm
packages, provide standalone templates, document manual integration, and
ensure no SelfAuth runtime service is mandatory. ADR 0003 named three modes:
CLI, optional framework packages, and manual templates.

## Decision

1. **Published packages are development tools only.** `@selfauth/cli`,
   `@selfauth/spec`, `@selfauth/migration` and `@selfauth/conformance` are
   published, versioned together (a changesets `fixed` group, `0.x`) with npm
   provenance. There is **no runtime helper package in 0.x**. ADR 0003's
   "packages" mode is satisfied by these dev tools; generated code imports
   nothing from SelfAuth. A test checks every CLI variant: no `@selfauth/*`
   dependency, every import declared, no host but localhost or reserved
   placeholder domains. A runtime package would need its own ADR, because it
   would make SelfAuth's release cadence part of every app's security.
2. **`selfauth` is published as an alias** of `@selfauth/cli`. The unscoped
   name was free, having been unpublished by its previous owner. Without it,
   `npx selfauth`, which our docs use, would run whatever package someone else
   registers under that name.
3. **Templates are generated and committed.** `templates/{express,
   express-vue, express-react, existing-express}` come from `planInit` and
   `planAdd` (`scripts/sync-templates.mjs`), so they are byte for byte the
   CLI output, and therefore the tested reference implementation
   (ADR 0018). CI fails when they drift (`pnpm templates:check`). They are
   excluded from lint and format, because their sources are linted where
   they live.
4. **"Runs without SelfAuth" is tested, not claimed.** A CI job copies
   `templates/express` outside the repository and runs it with only npm and
   Prisma. The CLI path is set to a nonexistent file, so any accidental use
   fails. The job installs, typechecks, builds, migrates and seeds, then runs
   the full sign-up → verify → login → protected route → logout flow.
5. **Packaging is tested as published.** `scripts/pack-check.sh` packs each
   package with `pnpm pack`, which rewrites `workspace:` dependencies. It
   checks the tarballs (README, LICENSE, bundled templates and skill, no
   sources or tests), installs them with npm into an empty project, and runs
   them. A CI job then runs the generated-project smoke tests with the
   packaged CLI.
6. **Releases are PR-gated.** `release.yml` uses `changesets/action`. Pushes
   to `main` open a "version packages" PR, and merging it publishes.
   `pnpm version-packages` also syncs everything that records the version
   (skill metadata, templates). Publishing needs the maintainer's
   `NPM_TOKEN` (docs/releasing.md).
7. **API documentation is checked against the code.** `docs/api/http.md`
   must list exactly the routes the router registers, and `docs/api/server.md`
   must document every export and every `Auth` member.

## Consequences

- Manual users get the same code as CLI users, and the same upgrade path:
  the manifest is copied too, so `selfauth diff` works later.
- Committed templates add about 200 files of generated code. The drift check
  keeps them honest, and they make every file inspectable on GitHub without
  installing anything.
- Nothing is on npm until the maintainer creates the `selfauth` org, reserves
  the unscoped name, and merges the first release PR.
