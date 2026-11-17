# 0023 — Full-stack projects are two packages in one workspace

- Status: accepted
- Date: 2026-11-17

## Context

`selfauth init --frontend vue|react` put the API at the project root (`src/`, `test/`, `prisma/`,
`package.json`, `tsconfig.json`) and the frontend in a `web/` subfolder. A tester found it hard to
read: the backend was spread across the root, the frontend looked like an attachment, and `src` did
not say it was the server. Renaming `src` to `server` alone would have left `test/`, `prisma/` and
`package.json` behind, and would have given API-only projects a pointless `server/` folder.

## Decision

- A project with a frontend is a **workspace of two real packages**: `server/` (the API, with its own
  `package.json`, `tsconfig`, `.env.example`, `src/`, `test/`, `prisma/`) and `client/` (the Vue or
  React app). The root holds only `package.json` (npm workspaces; `npm run dev` runs both with
  `concurrently`, which also works on Windows), `README.md` and `.gitignore`.
- **API-only projects stay flat** with `src/` at the root: there is nothing to separate.
- **Each package has its own manifest** (`layout: "server"` and `"client"`, `structure: 3`). Manifest
  paths are relative to the package, so `doctor`, `validate`, `diff` and `upgrade` work in each exactly
  as in any other package, and the existing monorepo story (ADR 0019) applies unchanged. At the
  workspace root, those commands run over both packages (`projectDirs`), and inside a package they find
  the nearest manifest above.
- The templates are unchanged: the reference apps (`apps/playground*`) keep their layout and the
  registry still maps them; `planInit` places the files by scope (`server` or `client`).
- Prisma is found by walking up from the package, because npm hoists it to the workspace root; it is
  started with Node rather than through the `.bin` shim, which Windows cannot execute.
- **Existing projects migrate** with `selfauth upgrade --reorganize`, the same command as for the
  grouped `src/` (ADR 0018 addendum). It moves whole folders (no imports change), splits `package.json`
  and the manifest, and creates the workspace root. Round-trip tests prove that a project taken back
  to either older layout is restored to exactly what `init` writes today.

## Consequences

- A clearer picture for new users, and each package is a normal npm package: it can later be deployed
  or moved to its own repository without untangling.
- A third layout version to support. `upgrade` keeps working on the older layouts for full-stack
  projects; only the flat `src/` of 0.3 and earlier must be reorganized first.
- Generated `README.md` and `.gitignore` are the project's own once written; `--reorganize` patches the
  one `.gitignore` line it must and leaves the README to the developer.
