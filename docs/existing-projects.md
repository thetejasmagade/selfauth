# Adding SelfAuth to an existing project

`selfauth add` and `selfauth add-frontend` work on projects that were not made
by SelfAuth, in whatever folder layout they have. Both only **create new
files**. Your own files are never edited; the commands print the few edits you
make yourself.

```bash
npx selfauth detect          # reads only: what is here and which command applies
npx selfauth add --dry-run   # the backend: shows every file it would create
npx selfauth add-frontend --dry-run   # a Vue or React app
```

## Where the files go

SelfAuth writes into one folder, `selfauth/`, next to your code, so nothing
collides with it:

| Your code lives in | Files go to | Command |
| --- | --- | --- |
| `src/` (the default) | `src/selfauth/` | `selfauth add` |
| `server/` | `server/selfauth/` | `selfauth add --src server` |
| `backend/src/` | `backend/src/selfauth/` | `selfauth add --src backend/src` |
| the project root | `selfauth/` | `selfauth add --src .` |

You usually don't need `--src`. `add` finds the file that creates your Express
app (`express()`) and writes beside it: an entry in `server/index.ts` means
`server/`, one in `backend/src/app.ts` means `backend/src/`. It tells you what
it chose and why. `selfauth detect` shows the same choice, and the other
Express files it found if there are several.

`--src` is a path inside the project. `..` and absolute paths are refused.

PostgreSQL adds `prisma/` at the project root, where Prisma expects it. The
generated Prisma client goes to `<src>/selfauth/generated/`, so add that to
`.gitignore`.

### Your tsconfig must compile the new folder

The generated code has to be compiled by your TypeScript setup. `add` checks
your `tsconfig.json` before writing anything and stops if the new folder would
be left out:

```text
✗ tsconfig "include" (src) does not cover server/selfauth/: add "server"
```

It checks `include`, `files`, `exclude` and `rootDir`. If your tsconfig
`extends` another file and has no `include` of its own, it can't tell and warns
you to check. It also lists the compiler options to add
(`allowImportingTsExtensions`, `rewriteRelativeImportExtensions`).

## Monorepos

Run the commands **in the package**, not at the repository root. At the root,
`selfauth detect` reads `pnpm-workspace.yaml` or `workspaces` in `package.json`
and tells you which package is which:

```text
Recommendation: workspace — Monorepo root. Backend packages: apps/api. Frontend packages: apps/web. …
  ✓ selfauth add apps/api
  ✓ selfauth add-frontend apps/web
```

Each package gets its own `selfauth.manifest.json`, so `doctor`, `validate`,
`diff` and `upgrade` run per package, in that package's folder. Nothing is
written at the repository root.

A project that `selfauth init --frontend vue|react` generated is already set up
this way: `server/` and `client/` in one npm workspace, each with its own
manifest. At its root, `doctor`, `validate`, `diff` and `upgrade` cover both
packages.

## A frontend in another folder, or another repository

The backend and the frontend are separate commands, because they are separate
projects. Run each where its code is:

```bash
cd apps/api && npx selfauth add --database postgresql --permissions orders.view
cd apps/web && npx selfauth add-frontend
```

`add-frontend` works on **Vue and React** apps. It copies only the
authentication module: the API client, session state, route guard (Vue) or
`<RequireAuth>` (React), `<Can>`, and the redirect and URL-token helpers. It
goes under `src/selfauth/` (or `--src <folder>`). It generates **no pages**: you
build your own login and sign-up screens with the client.

It prints the wiring for your entry file, for example in Vue:

```ts
import { createAuthClient, createAuthPlugin, createAuthStore, installAuthGuard } from "./selfauth/index.ts";
const client = createAuthClient({ onUnauthenticated: () => store.markSignedOut() });
const store = createAuthStore(client);
installAuthGuard(router, store, { login: "/login", forbidden: "/forbidden", home: "/" });
createApp(App).use(createAuthPlugin(store)).use(router).mount("#app");
```

The module needs `vue` and `vue-router` (or `react` and `react-router`). If one
is missing, `add-frontend` says which and prints the install command
(`--install` runs it). Its own manifest has `"layout": "frontend"`, so
`selfauth validate` in the frontend folder checks only the module's files.

### How the browser reaches the API

This is the decision that matters for security, and `add-frontend` does not
make it for you. See [Frontend deployment](frontend-deployment.md):

1. **Same origin** (recommended). A dev-server proxy sends `/auth` and `/api` to
   the backend, and one domain serves both in production. Cookies and CSRF just
   work.
2. **Sibling subdomains** (`app.example.com` and `api.example.com`): list the
   frontend in `http.trustedOrigins`, give the client a `baseUrl`, and keep the
   session cookie host-only on the API's domain.
3. **Different sites.** Needs `SameSite=None`, token-mode CSRF, and the API's
   `http.trustedOrigins` set to your frontend. The client takes
   `createAuthClient({ baseUrl: "https://api.example.com" })`.

Whichever you pick, the backend only trusts the frontend origin you give it in
`SELFAUTH_APP_BASE_URL`, and the frontend must send `X-SelfAuth-CSRF: 1` on
state-changing requests (the client does).

## What is not supported

- Frontends other than Vue and React (Angular, Svelte, Next.js, …). They can
  call the API by hand; see [the HTTP API](api/http.md).
- A database that is not PostgreSQL, SQLite or the in-memory store (MySQL and MongoDB are planned).
- A backend that is not Express 5 or Fastify 5 + TypeScript (see the
  [support matrix](conformance.md#support-matrix)).
- Several Express or Fastify apps in one package: `add` uses the first entry
  file and lists the others; pass `--src` for another. A project listing both
  `express` and `fastify` is treated as Express unless you pass
  `--backend fastify`.
- Merging into an existing Prisma schema (use `--database memory` to try it, or
  copy the models by hand as a reviewed migration).

## Keeping it up to date

`selfauth diff` and `selfauth upgrade` work in each folder you added SelfAuth
to. Files you never edited are updated; files you edited get a
`<file>.selfauth-new` proposal beside them. See [Upgrading](upgrading.md).
