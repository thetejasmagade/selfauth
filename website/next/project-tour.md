---
title: "3. Find your way around"
description: The files in a generated Next.js project, which ones you'll change, which ones to leave alone, and the npm scripts.
keywords: [next.js project structure, selfauth files, route handlers, withAuth, selfauth.config.ts, prisma schema, app router]
---

# 3. Find your way around

Here's what you got. You'll only change a handful of these files, marked ★.

```text
notes-app/
├── src/
│   ├── app/
│   │   ├── auth/[[...path]]/route.ts   every /auth route (login, register, me, ...)
│   │   ├── api/
│   │   │   ├── hello/route.ts          ★ your API routes: one route.ts per path
│   │   │   └── [[...path]]/route.ts    unknown /api paths get the error format
│   │   ├── health/route.ts             the health check
│   │   ├── layout.tsx                  ★ the page shell: header and session state
│   │   ├── page.tsx                    ★ the home page
│   │   ├── login/page.tsx              the account pages: login, register,
│   │   ├── register/page.tsx             verify-email, forgot-password,
│   │   └── account/page.tsx              reset-password, account
│   ├── screens/                    ★ what the pages draw (the account screens are in auth/)
│   ├── auth-client/                SelfAuth's browser module: read it, don't change it
│   ├── lib/
│   │   └── auth.ts                 starts SelfAuth, and gives you withAuth
│   ├── instrumentation.ts          starts SelfAuth when the server boots (lib/start.ts)
│   ├── config/
│   │   ├── selfauth.config.ts      ★ roles, permissions, password rules, session length
│   │   ├── env.ts                  reads environment variables
│   │   └── dev-config.ts           cookie settings for http://localhost
│   ├── email/
│   │   └── mailer.ts               ★ connects your email provider (chapter 10)
│   ├── db/
│   │   └── store.ts                opens the database
│   ├── http/errors.ts              error responses
│   ├── auth/                       SelfAuth's server code: read it, don't change it
│   └── scripts/                    seed and create-admin
├── prisma/
│   ├── schema.prisma               ★ your database tables
│   └── migrations/                 one folder per database change
├── test/
│   └── auth.smoke.test.ts          ★ tests (chapter 9)
├── next.config.ts                  Next.js settings
├── .env                            your local settings, never committed
├── package.json
└── selfauth.manifest.json          a record of what SelfAuth generated
```

With `--frontend none` there are no pages: no `layout.tsx`, `page.tsx`, `screens/`, `auth-client/` or account pages, only the API.

## The files that matter

**`src/app/api/`** is where your API goes. Each folder is a path, and the `route.ts` inside it answers it: `src/app/api/hello/route.ts` answers `/api/hello`. A route file exports one function per HTTP method (`GET`, `POST`, ...), and each one is built with `withAuth`, which is how it learns who's calling. You'll write three of these in the next chapters.

**`src/lib/auth.ts`** builds SelfAuth the first time a request arrives and gives you `withAuth`. You rarely open it.

**`src/config/selfauth.config.ts`** holds every setting: which permissions exist, which role gets which, how long sessions last, how long passwords must be. Changing behavior almost always means changing this file, not code. The [configuration reference](/reference/config-file) lists everything.

**`prisma/schema.prisma`** describes your database tables. SelfAuth's tables are already there, and you'll add your own in [chapter 6](./notes).

**`src/auth/`** is the security core: password hashing, sessions, rate limits. It's tested by SelfAuth's suite of security checks. Read it as much as you like, but if you change it, you're on your own. `npx selfauth validate` tells you if a file there has changed.

**`src/screens/` and `src/app/*/page.tsx`**: a page file in `src/app` only picks what to draw, and the drawing is in `src/screens`. The five account screens are in `src/screens/auth/`, unstyled, for you to restyle.

::: warning Don't make a `src/pages` folder
In Next.js a folder called `pages` is the older Pages Router, and it would serve every file in it as a page. That's why SelfAuth's screens live in `src/screens`.
:::

## How a request flows

`/auth/login` and `/api/notes` are both just route handlers. Each one is wrapped so that, before your code runs, the same steps happen in the same order:

1. the response is given a request id, and a CORS preflight is answered,
2. the session cookie is read and the user is looked up,
3. the CSRF check runs for anything that changes data,
4. your function runs (for `auth.protect`, only after the guards allow it),
5. any error becomes the standard error format, and the response is marked `Cache-Control: no-store`.

Pages don't go through any of that: the browser draws them, then asks `/auth/me` who you are.

## The npm scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts Next.js in development, reloading when you save |
| `npm test` | Runs the tests in `test/` |
| `npm run typecheck` | Checks the TypeScript without running anything |
| `npm run build` | Builds for production (it needs no environment variables) |
| `npm start` | Runs the production build |
| `npm run generate` | Regenerates the Prisma client after you change `schema.prisma` |
| `npm run db:seed` | Writes roles and permissions to the database |
| `npm run db:create-admin you@example.com` | Makes an account an administrator |

And the `selfauth` commands you'll use most:

| Command | What it does |
| --- | --- |
| `npx selfauth db plan` | Shows which migrations would run, and warns about risky ones |
| `npx selfauth db migrate` | Applies them |
| `npx selfauth db generate <name>` | Writes a new migration from your changes to `schema.prisma` |
| `npx selfauth validate` | Checks your configuration and which generated files you changed |
| `npx selfauth doctor` | Checks whether you're ready for production |

## Check it worked

Open `src/app/api/hello/route.ts`. You should see an exported `GET` built with `withAuth` and `auth.protect(auth.requireAuth, ...)`: the route you called in the last chapter. That's where you'll work next.

Next: [Add API routes](./endpoints)
