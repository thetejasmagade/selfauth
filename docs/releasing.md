# Releasing (maintainers)

Packages: `@selfauth/cli`, `selfauth` (the `npx selfauth` alias),
`@selfauth/spec`, `@selfauth/migration` and `@selfauth/conformance`. They
are versioned together (a changesets `fixed` group) and published with npm
provenance. Generated projects depend on none of them.

## One-time setup

1. Create the npm organization **`selfauth`**, which owns the `@selfauth/`
   scope, and reserve the unscoped package name **`selfauth`**. Without the
   unscoped name, anyone could publish a package that `npx selfauth`
   resolves to.
2. Create an npm **granular access token** with publish rights to those
   packages. Add it as the `NPM_TOKEN` repository secret (Settings → Secrets
   and variables → Actions).
3. After the first publish, you may switch each package to **trusted
   publishing** (npm → package settings → Trusted publisher: this repository,
   workflow `release.yml`). Then remove the token.

## Every release

1. PRs that change a published package include a changeset (`pnpm changeset`).
2. On merge to `main`, `.github/workflows/release.yml` opens or updates the
   **"Release: version packages"** PR. That PR bumps versions, writes the
   changelogs, and runs `pnpm version-packages`, which also updates
   everything that records the version: the skill's `metadata.version` and
   `templates/` (`scripts/sync-versions.mjs`).
3. Review that PR. CI runs the full suite there, including
   `scripts/pack-check.sh` (pack, install the tarballs outside the repo, run
   the CLI) and the generated-project smoke tests with the packaged CLI.
4. Merge it. The workflow then runs `pnpm release`: build, pack check,
   `changeset publish`.
5. Tag the release: `changeset publish` creates `@selfauth/cli@x.y.z`-style
   tags. Write the GitHub release notes from the changelog.

## Checks you can run locally

```bash
pnpm build && scripts/pack-check.sh /tmp/selfauth-packed
SELFAUTH_SMOKE_CLI=/tmp/selfauth-packed/node_modules/@selfauth/cli/dist/bin.js scripts/smoke-generated.sh memory none
pnpm templates:check
```
