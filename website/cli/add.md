---
title: selfauth add and add-frontend
description: Add SelfAuth to an existing Express or Fastify TypeScript project, or its authentication module to an existing Vue or React app. Options, where files are written, the manual steps and limits.
keywords: [selfauth add, add-frontend, existing project, --src, --allow-existing-auth, monorepo, tsconfig]
---

# `selfauth add` and `selfauth add-frontend`

These commands put SelfAuth into a project you already have. They create new files only. Your own files are never edited: the commands print the few edits you make yourself.

Run `npx selfauth detect` first: it tells you which command applies. For the step-by-step walkthrough with layouts and monorepos see [Existing projects](/advanced/existing-projects).

## `selfauth add`

Adds the backend to an existing Express 5 or Fastify 5 + TypeScript project (ESM, TypeScript 5.7 or newer).

```text
selfauth add [dir] [options]
```

| Option | Values | Default | Meaning |
| --- | --- | --- | --- |
| `--backend <framework>` | `express`, `fastify` | the one found in `package.json` | A project listing both is treated as Express unless you say `fastify` |
| `--database <db>` | `memory`, `postgresql`, `mysql`, `sqlite`, `mongodb` | `memory` | The store |
| `--src <dir>` | a path inside the project | found from the file that creates your app | Files go to `<dir>/selfauth/`. `..` and absolute paths are refused |
| `--permissions <list>` | comma-separated | none | Your permissions |
| `--app-base-url <url>` | an `http(s)` address | `http://localhost:5173` | Frontend address for email links |
| `--allow-existing-auth` | – | – | Continue although other auth packages are installed (for a gradual migration) |
| `-y`, `--yes` | – | – | Do not ask |
| `--dry-run` | – | – | Show the plan only |
| `--install` | – | – | Install the dependencies with your package manager |

### Where the files go

| Your code lives in | Files go to | Command |
| --- | --- | --- |
| `src/` | `src/selfauth/` | `selfauth add` |
| `server/` | `server/selfauth/` | `selfauth add --src server` |
| `backend/src/` | `backend/src/selfauth/` | `selfauth add --src backend/src` |
| the project root | `selfauth/` | `selfauth add --src .` |

You usually do not need `--src`: `add` finds the file that creates your app and writes beside it, and tells you what it chose.

### What you must do yourself

`add` prints these steps at the end. In short:

1. Compiler options. Add `allowImportingTsExtensions` and `rewriteRelativeImportExtensions` to `tsconfig.json`. `add` first checks that your `tsconfig.json` covers the new folder and stops if it does not.
2. Wire it in (Express):

   ```ts
   const selfauth = await setupSelfAuth(app);   // before your routes
   app.use(selfauth.errorHandler);              // after your routes
   ```

3. Set the environment: `SELFAUTH_APP_BASE_URL` and, for a database, `DATABASE_URL`.
4. Guard your routes with `selfauth.auth.requireAuth` and friends.
5. Your frontend must send `X-SelfAuth-CSRF: 1` on state-changing requests. This protects your whole app, not only `/auth`.
6. For Prisma databases, add `<src>/selfauth/generated/` to `.gitignore`.

### Limits

- Not for Go projects.
- Merging into an existing Prisma schema is not supported. Use `--database memory` to try it, or copy the models by hand as a reviewed migration.
- Several Express apps in one package: `add` uses the first entry file and lists the others; pass `--src` for another.

## `selfauth add-frontend`

Adds the authentication module to an existing Vue or React app: the API client, session state, route guard (Vue) or `<RequireAuth>` (React), `<Can>`, and the redirect and URL-token helpers. It generates no pages: you build your own sign-in and sign-up screens with the client.

```text
selfauth add-frontend [dir] [options]
```

| Option | Values | Default | Meaning |
| --- | --- | --- | --- |
| `--frontend <name>` | `vue`, `react` | found from `package.json` | |
| `--src <dir>` | a folder | `src` | Files go to `<dir>/selfauth/` |
| `-y`, `--yes` | – | – | Do not ask |
| `--dry-run` | – | – | Show the plan only |
| `--install` | – | – | Install missing packages |

The module needs `vue` and `vue-router` (or `react` and `react-router`). If one is missing, the command says which and prints the install command.

It prints the wiring for your entry file. For Vue:

```ts
import { createAuthClient, createAuthPlugin, createAuthStore, installAuthGuard } from "./selfauth/index.ts";
const client = createAuthClient({ onUnauthenticated: () => store.markSignedOut() });
const store = createAuthStore(client);
installAuthGuard(router, store, { login: "/login", forbidden: "/forbidden", home: "/" });
createApp(App).use(createAuthPlugin(store)).use(router).mount("#app");
```

How the browser reaches the API is your decision and `add-frontend` does not make it: see [Frontend deployment](/configuration/frontend-deployment).

## Monorepos

Run the commands inside the package, not at the repository root. At the root, `selfauth detect` reads `pnpm-workspace.yaml` or the `workspaces` field and tells you which package is which:

```bash
cd apps/api && npx selfauth add --database postgresql --permissions orders.view
cd apps/web && npx selfauth add-frontend
```

Each package gets its own `selfauth.manifest.json`.
