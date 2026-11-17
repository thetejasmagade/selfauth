---
"@selfauth/cli": minor
"@selfauth/migration": minor
"@selfauth/spec": minor
"@selfauth/conformance": minor
"selfauth": minor
---

Generated projects now have a proper folder structure. The app files that used to sit side by side in
`src/` are grouped by responsibility: `src/config/` (selfauth.config.ts, env.ts, dev-config.ts),
`src/email/mailer.ts`, `src/db/store.ts`, `src/http/` (errors, request-id) and `src/routes/`. In `web/`,
the five SelfAuth screens (login, register, verify email, forgot and reset password) moved to
`src/pages/auth/`, leaving `src/pages/` for the app's own pages. The generated README shows the layout. `selfauth add` uses the same grouping under `<src>/selfauth/`.

Projects made with 0.3 or earlier keep working with `doctor` and `validate`. `selfauth upgrade
--reorganize` moves them to the new layout (moves the files, rewrites the relative imports, updates the
manifest, including `web/` pages); a round-trip test proves it restores exactly what a new project has. `upgrade` itself asks
you to run it first, because the new templates import each other from the new places.

The ownership manifest records `options.structure`.
