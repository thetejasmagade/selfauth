---
"@selfauth/cli": minor
"@selfauth/migration": minor
"@selfauth/spec": minor
"@selfauth/conformance": minor
"selfauth": minor
---

Existing projects in any layout.

- `selfauth add --src <folder>`: write under `<folder>/selfauth/` when the code is not in `src/`. Without
  it, `add` finds the folder from the Express entry file. It refuses, before writing, when `tsconfig.json`
  would not compile the new folder.
- `selfauth add-frontend`: adds the authentication module (client, session state, route guards, `<Can>`)
  to an existing Vue or React app, in any folder or repository. It writes new files only, with its own
  manifest, and generates no pages. `validate`, `doctor`, `diff` and `upgrade` work in that folder.
- `selfauth detect` reports the source folder, the Express entry file, monorepo packages and frontends,
  with the command to run in each. The agent skill gained a project-layouts reference.
- The ownership manifest records `srcDir` and the new `frontend` layout.
