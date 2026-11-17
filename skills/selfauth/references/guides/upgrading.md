<!-- Generated from docs/upgrading.md by skills/scripts/sync-references.mjs. Do not edit; edit the guide. -->

# Upgrading

Generated code is yours, so upgrades never happen silently (ADR 0004). A new
SelfAuth release offers changes; you decide which to take.

## With the CLI

```bash
npm install -D @selfauth/cli@latest      # or: npx @selfauth/cli@latest …
npx selfauth diff                        # every change, as a diff; writes nothing
npx selfauth upgrade                     # asks first; --dry-run to preview
```

What `upgrade` does to each generated file, using the hashes in
`selfauth.manifest.json`:

| Your file | Template changed? | Result |
| --- | --- | --- |
| unchanged since generation | yes | updated |
| edited by you | yes | kept. `<file>.selfauth-new` is written next to it for you to merge, then delete |
| edited by you | no | kept |
| deleted by you | — | stays deleted |
| new in the release | — | added (never over an existing file) |

Then:

1. **Merge every `.selfauth-new` proposal.** `git diff --no-index file
   file.selfauth-new` helps. `selfauth validate` lists what's left.
2. **Review and apply new migrations**: `npx selfauth db plan`, then
   `npx selfauth db migrate` (or `npm run db:migrate`), then `npm run
   db:seed`.
3. **Run your tests** and `npx selfauth doctor`.
4. **Update the agent skill** if you installed one:
   `npx selfauth skill install --agent … --update`.

## Moving to the grouped layout

SelfAuth 0.3 and earlier put the app files side by side in `src/`. Newer
releases group them by responsibility:

| Before | After |
| --- | --- |
| `src/selfauth.config.ts`, `src/env.ts`, `src/dev-config.ts` | `src/config/` |
| `src/mailer.ts` | `src/email/mailer.ts` |
| `src/store.ts` | `src/db/store.ts` |
| `src/errors.ts`, `src/request-id.ts` | `src/http/` |
| `src/routes.ts`, `src/example/notes.ts` | `src/routes/index.ts`, `src/routes/notes.ts` |

`src/auth/`, `src/scripts/`, `prisma/` and `web/` don't move. A project made
with the old layout keeps working: `doctor` and `validate` still understand
it. But `selfauth upgrade` refuses to update it, because the new templates
import each other from the new places. Move it with one command:

```bash
git commit -am "before reorganizing"        # so you can review the diff
npx selfauth upgrade --reorganize --dry-run  # lists every move and import change
npx selfauth upgrade --reorganize            # asks first; --yes to skip
npm run typecheck && npm test
npx selfauth upgrade                         # now offers newer templates as usual
```

It moves the files and rewrites the relative imports that point at them, in
`src/` and `test/` (for `selfauth add` projects: your whole source folder, since
your own files may import from `selfauth/`). Only paths change; no file's logic
is touched. A generated file you hadn't edited stays "unedited" in the
manifest, and a file you had edited stays yours. It stops without changing
anything if a target file already exists.

If you reorganize by hand instead, edit `selfauth.manifest.json` too (the
`path` of each moved file, and `"structure": 2` under `options`), or
`validate` reports the old paths as missing.

## Moving to the two-package layout

Full-stack projects (made with `--frontend vue|react`) used to keep the API at
the root and the frontend in `web/`. They are now two packages in one npm
workspace:

| Before | After |
| --- | --- |
| `src/`, `test/`, `prisma/`, `prisma.config.ts`, `tsconfig*.json`, `.env.example`, `.env` | `server/` (same names inside) |
| `package.json` | `server/package.json` (renamed `<name>-server`, without the `dev:web` and `build:web` scripts), plus a new workspace `package.json` at the root |
| `web/` | `client/` |
| `selfauth.manifest.json` | `server/selfauth.manifest.json` and `client/selfauth.manifest.json` |

`README.md` and `.gitignore` stay at the root (the `src/generated/` line becomes
`**/src/generated/`). API-only projects don't change. The old layout keeps
working, and `upgrade` still updates it. Moving is optional, with the same command:

```bash
git commit -am "before reorganizing"
npx selfauth upgrade --reorganize --dry-run   # every move and write, nothing changed
npx selfauth upgrade --reorganize
rm -rf node_modules client/node_modules package-lock.json   # on Windows: delete them in Explorer
npm install                                   # once, at the root: installs server/ and client/
npm run typecheck && npm test
```

Whole folders move, so no import changes. A project made with 0.3 or earlier is
brought through both steps in one run. Your own files under `src/` and `web/`,
your `.env`, extra dependencies and scripts all come along. The generated
`README.md` still describes the old layout, so update it by hand. From then on
`selfauth doctor`, `validate`, `diff` and `upgrade` work at the root and cover
both packages.

### The shared `selfauth.config.json`

New full-stack projects have a root `selfauth.config.json` that both packages
read for the password length limits ([customization](customization.md)). A
project moved with `--reorganize` (or made with an earlier version) does not
have it: its server config still holds the numbers, and the frontend's copy
`client/src/selfauth.config.json` arrives with the next `selfauth upgrade`, with
the default limits (8 and 128). Until you set up the root file, change the
password length in both places (`server/src/config/selfauth.config.ts` and
`client/src/selfauth.config.json`). To adopt the root file: copy the root file
and `scripts/sync-config.mjs` from a new project, add the `sync` and `pre*`
scripts to the three `package.json` files, and import the limits in the server
config as a new project does.

## Without the CLI (manual installations)

1. Compare your files with the new release's
   `templates/` (`templates/README.md` in the SelfAuth repository):
   `git diff --no-index templates/express/src/auth your-app/src/auth`, or
   compare two release tags of this repository
   (`git diff v0.1.0 v0.2.0 -- templates/express`).
2. Copy the changes you want. New `prisma/migrations/*` directories are
   additive: copy them and run `prisma migrate deploy`. Never edit a
   migration that has already been applied.
3. Copy the new `selfauth.manifest.json` too, so a later `selfauth diff`
   stays accurate.

## Versioning

- SelfAuth is `0.x`: minor versions may change generated code and
  behaviour. Each change is listed in the packages' `CHANGELOG.md`, with
  breaking changes and the steps to take.
- `specVersion` (in `selfauth.config.ts` and the manifest) is versioned
  separately from the packages. A spec bump means behaviour changed; the
  changelog says how.
- Security fixes ship as patch releases with an advisory. Upgrade promptly.
  `selfauth diff` shows exactly which files a fix touches.

## Migrating from another auth system

SelfAuth has no importer. Users and passwords from Passport, Auth0 or
similar don't move automatically, because SelfAuth verifies only Argon2id
hashes. The supported path:

1. Run SelfAuth next to the old system (`selfauth add --allow-existing-auth`).
2. Create the accounts with a one-off script that writes through the
   generated `AuthStore`. Call `createUser` with the user in the `pending`
   state and `passwordHash: await auth.hasher.hash(<32 random bytes>)`, a
   password nobody knows. Each user then sets their own password through the
   normal reset flow (`POST /auth/password/reset-request`). Completing it
   proves they own the email and activates the account. Old password hashes
   are never copied.
3. Remove the old system once traffic has moved.

Plan this with care; it is outside what SelfAuth tests.
