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
