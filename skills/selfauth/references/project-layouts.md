# Project layouts

How to handle projects that are not a single `src/` Express app. Both `add`
and `add-frontend` only create new files, in one folder named `selfauth/`.
Neither edits the developer's files; you make the printed edits.

## Where the backend files go: `--src`

`selfauth add` writes to `<src>/selfauth/`. It finds `<src>` from the file that
calls `express()`: `server/index.ts` gives `server`, `backend/src/app.ts` gives
`backend/src`, a file at the root gives `.`. `selfauth detect` shows the choice
(`layout.sourceDir`, `layout.basis`) and any other Express files
(`layout.otherEntryFiles`).

- Use what detect says. Pass `--src <dir>` only when it picked the wrong one,
  for example a test helper, or several Express apps in one package.
- `--src` must stay inside the project. Never pass `..` or an absolute path.
- Say which folder you chose in your report.

### tsconfig must compile it

`add` refuses, before writing, when `tsconfig.json` would not compile the new
folder (`include`, `files`, `exclude`, `rootDir`). The message names the fix,
for example `add "server"` to `include`. That is an edit to the developer's
file: put it in the plan they approve (step 6). When the tsconfig uses
`extends` and has no `include` of its own, `add` can't tell: it warns, and you
check that the folder is compiled by running the project's typecheck.

## Monorepos

Run each command inside the package, never at the repository root. At the root
`selfauth detect` returns `recommendation: workspace` and lists
`workspaces[]` with each package's `role` (`backend`, `frontend`, `other`).

1. Run detect-project on each backend and frontend package.
2. `selfauth add <backend-package> …` for the Express package.
3. `selfauth add-frontend <frontend-package>` for a Vue or React package.
4. Validate each package separately (`validate-auth.ts <package>`). Each has its
   own `selfauth.manifest.json`.

Ask the developer which package is the API when there are several backends.
Don't guess.

## A frontend in another folder or repository

The backend and frontend are separate commands, run where each lives.
`selfauth add-frontend` supports **Vue and React** only. It copies the
authentication module (API client, session state, route guard or
`<RequireAuth>`, `<Can>`, redirect and URL-token helpers) to `src/selfauth/`
(or `--src`). It generates **no pages**.

After it runs:

- Do the steps it prints: install missing packages (`vue-router` or
  `react-router`), wire the client, store and guard in the entry file, and
  mark protected routes.
- Build the login, sign-up, verify-email and reset-password screens with the
  client. Email links put the one-time token in the URL **fragment**; read it
  with `takeTokenFromFragment()` (it also removes it from the address bar) and
  never put a token in a query string or log.
- Use `safeRedirect` for any post-login redirect target.
- Use `client.api(method, path, body)` for the application's own calls so
  cookies and the CSRF header are handled.

For other frontends (Angular, Svelte, Next.js, …) there is no generator.
Report that. The HTTP contract is documented, but writing a client by hand is
the developer's decision, not yours.

### How the browser reaches the API

Don't choose this silently. Ask, then record it in the report:

1. **Same origin** (recommended): a dev-server proxy for `/auth` and `/api`, one
   domain in production. Nothing extra to configure.
2. **Sibling subdomains**: `http.trustedOrigins` lists the frontend origin and
   `createAuthClient({ baseUrl })` points at the API. Keep the session cookie
   host-only on the API's domain; setting `Domain` shares it with every
   subdomain.
3. **Different sites**: `sessions.cookie.sameSite: "none"`, `http.csrf.mode:
   "token"` with `SELFAUTH_CSRF_SECRET`, `http.trustedOrigins` listing the
   frontend, and `createAuthClient({ baseUrl, csrf: { mode: "token" } })`.
   `selfauth doctor` warns about this setup on purpose.

The backend trusts only the origin in `SELFAUTH_APP_BASE_URL`. A mismatch shows
up as `CSRF_FAILED` on every POST.

## Reporting

For a split project, report each part on its own: the backend command and
folder, the frontend command and folder, the tsconfig edits, the topology the
developer chose, and the `validate-auth` result for each package. A passing
backend says nothing about the frontend.
