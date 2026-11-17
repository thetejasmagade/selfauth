---
"@selfauth/cli": patch
"selfauth": patch
"@selfauth/spec": patch
"@selfauth/migration": patch
"@selfauth/conformance": patch
---

Reverts the shared root `selfauth.config.json` added in 0.8.0. The password length is set again in the server's `selfauth.config.ts` only, and generated projects no longer have the root file, `scripts/sync-config.mjs`, the `sync`/`pre*` scripts or the copies in `server/` and `client/`. The frontend's register, reset and account pages go back to a fixed `minlength` hint, and the docs now list the three pages to edit when you change the password length. Projects made with 0.8.0 can delete the root `selfauth.config.json`, `scripts/` and the copies, and the `sync` and `pre*` scripts, though leaving them does no harm.
