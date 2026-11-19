---
title: "3. Find your way around"
description: The files in a generated Express project, which ones you'll change, which ones to leave alone, and the npm scripts.
keywords: [express project structure, selfauth files, routes index.ts, selfauth.config.ts, prisma schema]
---

# 3. Find your way around

Here's what you got. You'll only change a handful of these files, marked ★.

```text
notes-app/
├── src/
│   ├── server.ts               starts everything, in order
│   ├── app.ts                  builds the Express app
│   ├── routes/
│   │   └── index.ts            ★ your endpoints
│   ├── config/
│   │   ├── selfauth.config.ts  ★ roles, permissions, password rules, session length
│   │   ├── env.ts              reads environment variables
│   │   └── dev-config.ts       cookie settings for http://localhost
│   ├── email/
│   │   └── mailer.ts           ★ connects your email provider (chapter 11)
│   ├── db/
│   │   └── store.ts            opens the database
│   ├── http/                   error responses and request ids
│   ├── auth/                   SelfAuth's code: read it, don't change it
│   └── scripts/                seed and create-admin
├── prisma/
│   ├── schema.prisma           ★ your database tables
│   └── migrations/             one folder per database change
├── test/
│   └── auth.smoke.test.ts      ★ tests (chapter 10)
├── .env                        your local settings, never committed
├── package.json
└── selfauth.manifest.json      a record of what SelfAuth generated
```

## The files that matter

**`src/routes/index.ts`** is where your endpoints go. The `mountRoutes` function in it is called once, after SelfAuth's middleware has run, so every endpoint you add there already knows who's signed in. It receives three things:

| | What it is |
| --- | --- |
| `app` | The Express app |
| `auth` | SelfAuth: the guards that protect routes, and `auth.context(res)` to find out who's calling |
| `db` | The database client, for your own tables. It's `undefined` if the app runs without a database. |

**`src/config/selfauth.config.ts`** holds every setting: which permissions exist, which role gets which, how long sessions last, how long passwords must be. Changing behavior almost always means changing this file, not code. The [configuration reference](/reference/config-file) lists everything.

**`prisma/schema.prisma`** describes your database tables. SelfAuth's tables are already there, and you'll add your own in [chapter 6](./add-a-table).

**`src/auth/`** is the security core: password hashing, sessions, rate limits. It's tested by SelfAuth's suite of security checks. Read it as much as you like, but if you change it, you're on your own. `npx selfauth validate` tells you if a file there has changed.

## How a request flows

`src/server.ts` is short and worth reading. It does this, in order:

1. reads and checks the environment variables,
2. loads the configuration,
3. opens the database,
4. creates SelfAuth,
5. builds the app and calls your `mountRoutes`.

In the app, a request passes through the request id, the body parser, SelfAuth's middleware (session and CSRF), and then the routes: `/health`, `/auth/...`, then yours. If nothing matches, it gets a `404`.

## The npm scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the server, restarting when you save |
| `npm test` | Runs the tests in `test/` |
| `npm run typecheck` | Checks the TypeScript without running anything |
| `npm run build` | Compiles to `dist/` for production |
| `npm start` | Runs the compiled server |
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

Open `src/routes/index.ts`. You should see `mountRoutes(app, auth, db)` and the `/hello` endpoint you called in the last chapter. That's where you'll work next.

Next: [Add endpoints](./endpoints)
