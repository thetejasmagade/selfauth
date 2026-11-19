---
title: Existing projects
description: Add SelfAuth to a project you already have - Express or Fastify with TypeScript, any folder layout, monorepos, and a Vue or React frontend in another folder or repository. What is supported and what you wire up yourself.
keywords: [existing project, add selfauth, monorepo, --src, add-frontend, tsconfig, retrofit, integrate]
---

# Existing projects

[`selfauth add`](/cli/add) and `selfauth add-frontend` work on projects SelfAuth didn't create, whatever their folder layout. They only create new files and never edit yours. They print the few edits you need to make yourself.

```bash
npx selfauth detect                    # reads only: what is here and which command applies
npx selfauth add --dry-run             # the backend: every file it would create
npx selfauth add-frontend --dry-run    # a Vue or React app
```

## Is my project supported?

| Requirement | Detail |
| --- | --- |
| Backend | Express 5 or Fastify 5 |
| Language | TypeScript 5.7 or newer, ESM (`"type": "module"`) |
| Database | In-memory, PostgreSQL, MySQL, SQLite or MongoDB |
| Frontend (`add-frontend`) | Vue or React |

These aren't supported: Go projects (use `init --backend gin` for new ones), other frameworks (Angular, Svelte and Next.js can call the [HTTP API](/api/http) by hand), merging into an existing Prisma schema (use `--database memory` to try it, or copy the models in by hand as a reviewed migration), and several Express apps in one package (pass `--src`).

## Step by step: the backend

1. Detect. `npx selfauth detect` tells you the framework, the folder it will use and any existing auth packages. If other auth libraries are installed, add `--allow-existing-auth` to carry on, which suits a gradual migration.
2. Preview with `npx selfauth add --database memory --dry-run`.
3. Add with `npx selfauth add --database memory --install`. The files go into `src/selfauth/`.
4. Fix the compiler options. Your `tsconfig.json` has to compile the new folder and set `allowImportingTsExtensions` and `rewriteRelativeImportExtensions`. `add` checks `include`, `files`, `exclude` and `rootDir`, and stops with a message like this one if something's off:

   ```text
   ✗ tsconfig "include" (src) does not cover server/selfauth/: add "server"
   ```

5. Wire it in (two lines, plus guards):

   ```ts
   import { setupSelfAuth } from "./selfauth/setup.ts";

   const app = express();
   app.use(express.json());
   const selfauth = await setupSelfAuth(app);     // before your routes
   app.get("/api/account", selfauth.auth.requireAuth, handler);
   app.use(selfauth.errorHandler);                // after your routes
   ```

6. Set the environment. You need `SELFAUTH_APP_BASE_URL`, and `DATABASE_URL` if you use a database. See [Environment variables](/configuration/environment).
7. Make your frontend send `X-SelfAuth-CSRF: 1` on state-changing requests. CSRF protection now covers your whole app.
8. Check with `npx selfauth doctor` and `npx selfauth validate`.

## Where the files go

| Your code lives in | Command |
| --- | --- |
| `src/` | `selfauth add` |
| `server/` | `selfauth add --src server` |
| `backend/src/` | `selfauth add --src backend/src` |
| the project root | `selfauth add --src .` |

`add` finds the file that creates your app (`express()`), writes beside it, and tells you what it chose.

## Monorepos

Run each command inside the package. At the repository root, `selfauth detect` reads `pnpm-workspace.yaml` or `workspaces` and recommends:

```text
Recommendation: workspace — Monorepo root. Backend packages: apps/api. Frontend packages: apps/web. …
  ✓ selfauth add apps/api
  ✓ selfauth add-frontend apps/web
```

Each package gets its own `selfauth.manifest.json`, so `doctor`, `validate`, `diff` and `upgrade` run per package. Nothing is written at the repository root.

## A frontend in another folder or repository

```bash
cd apps/api && npx selfauth add --database postgresql --permissions orders.view
cd apps/web && npx selfauth add-frontend
```

`add-frontend` only copies the authentication module and generates no pages, so you build your own sign-in and sign-up screens with the client. Its manifest has `"layout": "frontend"`. How the browser reaches the API is your decision. See [Frontend deployment](/configuration/frontend-deployment).

## Keeping it up to date

`selfauth diff` and `selfauth upgrade` work in each folder you added SelfAuth to. See [`diff` and `upgrade`](/cli/upgrade).

## A worked example

The SelfAuth repository has `examples/existing-express-app`, with a `.selfauth.patch` showing the change applied to a real app. CI runs that app's own tests before and after.
