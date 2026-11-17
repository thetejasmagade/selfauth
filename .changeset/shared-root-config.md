---
"@selfauth/cli": minor
"selfauth": minor
"@selfauth/spec": minor
"@selfauth/migration": minor
"@selfauth/conformance": minor
---

Full-stack projects get one root `selfauth.config.json` for the settings the browser needs too (the password length limits). Edit it once: the server's config and the frontend's register, reset and account screens both read it, so the form can no longer disagree with the server. Each package imports a copy inside its own folder, written by `npm run sync` (run automatically before `dev`, `build`, `test` and `typecheck`), so the build, tsconfig and Vite are unchanged. `selfauth doctor` warns when a copy is stale. Existing projects keep working; `selfauth upgrade` adds the frontend's copy.
