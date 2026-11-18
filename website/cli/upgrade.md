---
title: selfauth diff and upgrade
description: Update the generated code of a SelfAuth project safely. How diff and upgrade treat files you edited, the .selfauth-new proposals, moving old layouts and the steps to follow after an upgrade.
keywords: [selfauth upgrade, selfauth diff, update, .selfauth-new, manifest, reorganize, migrate layout, safe upgrade]
---

# `selfauth diff` and `selfauth upgrade`

Generated code is yours, so a new SelfAuth release never changes it silently. `diff` shows what a newer release would change; `upgrade` applies the safe part and leaves the rest for you to merge.

## `selfauth diff`

```text
selfauth diff [dir]
```

Compares your project with the templates of the CLI you are running, and prints a diff for each file. It writes nothing.

**Output** when nothing needs doing:

```text
Templates 0.15.0 → 0.15.0

  • kept    (your edit; template unchanged)  src/routes/index.ts

25 file(s) unchanged.
```

To compare against a newer release, run the newer CLI:

```bash
npx @selfauth/cli@latest diff
```

## `selfauth upgrade`

```text
selfauth upgrade [dir] [options]
```

| Option | Meaning |
| --- | --- |
| `-y`, `--yes` | Apply without asking |
| `--dry-run` | Show the plan, write nothing |
| `--reorganize` | Move a project made with SelfAuth 0.3 or earlier into the current layout (see below) |

### What happens to each file

SelfAuth compares each file with the fingerprint in `selfauth.manifest.json` taken when it was generated.

| Your file | Did the template change? | Result |
| --- | --- | --- |
| Unchanged since generation | yes | Updated |
| Edited by you | yes | Kept. A proposal `<file>.selfauth-new` is written next to it for you to merge, then delete |
| Edited by you | no | Kept |
| Deleted by you | – | Stays deleted |
| New in the release | – | Added (never over an existing file) |

### The steps to follow

1. Commit your work first, so you can review the changes with `git diff`.
2. Run `npx @selfauth/cli@latest diff`, then `npx @selfauth/cli@latest upgrade`.
3. Merge each `.selfauth-new` proposal. `git diff --no-index file file.selfauth-new` helps. Delete the proposal when done. `selfauth validate` lists what is left.
4. Review and apply new migrations: `npx selfauth db plan`, then `npx selfauth db migrate`, then `npm run db:seed`. Never edit a migration that has been applied.
5. Run your tests and `npx selfauth doctor`.
6. Update the agent skill if you installed one: `npx selfauth skill install --agent claude --update`.

### Versioning

SelfAuth is `0.x`. Minor versions may change generated code and behavior. Each change is listed in the [changelog](/resources/changelog) with the steps to take. Security fixes ship as patch releases: upgrade promptly, and use `diff` to see exactly which files a fix touches.

## Moving old layouts

| Your project was made with | Layout | Move with |
| --- | --- | --- |
| SelfAuth 0.3 or earlier | Files side by side in `src/` | `upgrade --reorganize` into the grouped layout (`config/`, `email/`, `db/`, `http/`, `routes/`) |
| An earlier full-stack layout | API at the root, frontend in `web/` | `upgrade --reorganize` into `server/` and `client/` in one workspace |

Both keep working until you move, but `upgrade` refuses to update the old flat layout because the new templates import each other from the new places.

```bash
git commit -am "before reorganizing"
npx selfauth upgrade --reorganize --dry-run    # lists every move
npx selfauth upgrade --reorganize              # asks first; --yes to skip
npm run typecheck && npm test
```

Only paths and imports change; no file's logic is touched. It stops without changing anything if a target already exists.

## Without the CLI

If you installed by hand, compare your files with the new release's `templates/` folder (or two release tags: `git diff v0.14.0 v0.15.0 -- templates/express`), copy the changes you want, and copy the new `selfauth.manifest.json` so a later `diff` stays accurate. New migration folders are additive: copy them and apply them. Never edit one that was applied.
