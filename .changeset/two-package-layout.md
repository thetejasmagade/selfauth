---
"@selfauth/cli": minor
"@selfauth/migration": minor
"@selfauth/spec": minor
"@selfauth/conformance": minor
"selfauth": minor
---

Full-stack projects are now two real packages. `selfauth init --frontend vue|react` makes `server/` (the
Express API: its own `package.json`, `tsconfig`, `.env.example`, `src/`, `test/`, `prisma/`) and `client/`
(the Vue or React app) in one npm workspace, with a thin root: `package.json` (`npm run dev` starts both,
one `npm install` installs both), `README.md` and `.gitignore`. API-only projects are unchanged.

- Each package has its own `selfauth.manifest.json`. `doctor`, `validate`, `diff` and `upgrade` run at the
  workspace root over both packages, or inside either package; `db` finds the server from anywhere.
- `selfauth upgrade --reorganize` also moves an existing full-stack project (made with 0.5 or earlier)
  into this layout: whole folders move, `package.json` and the manifest are split, the root is created,
  and your own files, `.env`, scripts and dependencies come along. Round-trip tests restore exactly what
  `init` writes.
- Prisma is found in a parent folder (npm hoists it to the workspace root), and `detect` no longer flags
  SelfAuth's own files in a workspace as foreign authentication code.
- The ownership manifest gains the `server` and `client` layouts and `structure: 3`.
