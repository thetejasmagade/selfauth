---
"@selfauth/cli": minor
"selfauth": minor
"@selfauth/spec": minor
"@selfauth/migration": minor
"@selfauth/conformance": minor
---

Full-stack projects no longer ship the notes demo. `init --frontend vue|react` now generates the
five account screens, the account page and the guards, and the API has the same single protected
example route as an API-only project. The demo's permissions (`notes.*`) and the `support` role are
not added to `selfauth.config.ts`, and the nav bar has no demo link.

The reference apps keep the notes example for the browser tests; generation removes it with exact
replacements and fails loudly if a reference file changes. Existing projects are not touched:
`selfauth upgrade` reports the notes files as removed from the template and leaves them alone.
