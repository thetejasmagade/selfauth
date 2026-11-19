---
title: Quick start
description: Create a SelfAuth project, run it and see it work in ten minutes. Step-by-step commands with expected output for Express, with Gin and full-stack variants.
keywords: [quick start, getting started, install, selfauth init, npx selfauth, run first project]
---

# Quick start

Prefer to let your coding agent do this? The [AI skill](/ai-skill/) does it for you. Otherwise, you'll generate a project, start it and sign in, in about ten minutes. I'm using Express with the in-memory store because it needs nothing but Node.js. If you'd rather use [Gin](#variant-gin-go) or [Vue/React](#variant-with-a-frontend), those are at the bottom.

The blocks labelled "Output" were copied from a real run of this version. Ids, tokens and timestamps change every time, so yours will differ.

## Before you start

Make sure [Node.js 22.18 or newer](./prerequisites) is installed:

```bash
node --version
```

## Step 1: Generate the project

```bash
npx selfauth init my-app --database memory --permissions orders.view,orders.create -y
```

What those options mean:

| Part | Meaning |
| --- | --- |
| `npx selfauth init my-app` | Create a new project in a new folder called `my-app` |
| `--database memory` | Use the in-memory store (no database server) |
| `--permissions orders.view,orders.create` | Declare two permissions your app will use later |
| `-y` | Do not ask questions: accept the plan |

Skip the options and `init` asks you each question instead. It shows the list of files first and waits for a yes before writing anything.

Output (the file list is trimmed to the summary lines):

```text
SelfAuth init → /home/you/my-app

Plan: create 34 files (Express + in-memory store)
  ✓ Created 34 files and selfauth.manifest.json

Next steps:
  cd my-app
  npm install
  cp .env.example .env
  npm run dev

Before production: implement createMailer() in src/email/mailer.ts, then run `npx selfauth doctor`.
```

## Step 2: Install the dependencies

```bash
cd my-app
npm install
```

This installs Express and an Argon2 library for hashing. Nothing from SelfAuth is installed, because the generated code doesn't depend on it.

## Step 3: Create your settings file

```bash
cp .env.example .env
```

On Windows Command Prompt, use `copy .env.example .env`.

`.env` holds your environment variables, and the defaults suit local development:

```ini
NODE_ENV=development
PORT=3000
SELFAUTH_APP_BASE_URL=http://localhost:5173
```

`SELFAUTH_APP_BASE_URL` is the address of your frontend. It's only used to build the links in verification and password reset emails. See [Environment variables](/configuration/environment).

## Step 4: Start the server

```bash
npm run dev
```

Output:

```text
> my-app@0.1.0 dev
> node --env-file-if-exists=.env --watch src/server.ts

Using in-memory store.
Listening on http://localhost:3000
```

The server restarts whenever you save a file. Leave it running and open a second terminal for the rest.

## Step 5: Check that it's alive

```bash
curl -i http://localhost:3000/health
```

Output:

```text
HTTP/1.1 200 OK
...
{"status":"ok"}
```

## Step 6: See that protection works

`GET /api/hello` is an example route that needs a signed-in user:

```bash
curl -i http://localhost:3000/api/hello
```

Output:

```text
HTTP/1.1 401 Unauthorized
...
{"error":{"code":"UNAUTHENTICATED","message":"Authentication required.","requestId":"4f9b2df3-8a60-45ba-a5c0-b8a144b03d3a"}}
```

There's no session, so the request is refused with `UNAUTHENTICATED`. To get past that you have to sign in, and [the next page](./first-flow) does exactly that.

## Step 7: Run the tests

The project comes with tests for its authentication wiring, and they don't need a database.

```bash
npm test
```

Output (the end of the report):

```text
# tests 6
# suites 1
# pass 6
# fail 0
```

## Step 8: Check the project

The CLI can check on the project's health. It's optional, and it only runs on your machine:

```bash
npx selfauth doctor
```

Output:

```text
SelfAuth doctor → /home/you/my-app
  ⚠ in-memory store: data is lost on restart; use PostgreSQL, MySQL, SQLite or MongoDB in production
  ⚠ no email provider yet: implement createMailer() in src/email/mailer.ts before production
  • templates 0.15.0, spec 0.1, database memory

0 error(s), 2 warning(s).
```

Those two warnings are your to-do list before going to production. See [Going to production](/advanced/production).

## Variant: with a frontend

```bash
npx selfauth init my-app --database memory --frontend vue -y
cd my-app
npm install                  # one install covers server/ and client/
cp server/.env.example server/.env
npm run dev                  # API on :3000 and the Vue app on :5173
```

Open `http://localhost:5173` and you'll find working Sign in, Create account, Verify email, Forgot password and Account pages. Use `--frontend react` for React. [Full stack: Vue or React](/structure/full-stack) explains the folders.

## Variant: Gin (Go)

You'll need Go 1.26 or newer.

```bash
npx selfauth init my-api --backend gin --database memory --module github.com/you/my-api -y
cd my-api
export SELFAUTH_APP_BASE_URL=http://localhost:5173
go run ./cmd/server
```

Output:

```text
2026/11/18 11:38:21 Using in-memory store (set DATABASE_URL to use PostgreSQL).
2026/11/18 11:38:21 Listening on http://localhost:3000
```

A Gin server reads the process environment and doesn't load a `.env` file, which is why this uses `export`. On Windows PowerShell, use `$env:SELFAUTH_APP_BASE_URL="http://localhost:5173"`. Start the server from the project folder too, because it reads `selfauth.config.json` from the current directory. More in [Gin (Go) API](/structure/gin).

## Variant: PostgreSQL

```bash
npx selfauth init my-app --database postgresql -y
cd my-app && npm install
cp .env.example .env         # then edit DATABASE_URL
npx selfauth db plan         # review the migration
npm run db:migrate           # create the tables
npm run db:seed              # write the roles from your configuration
npm run dev
```

[`selfauth db`](/cli/db) and [What each database changes](/structure/databases) cover the details.

## If something fails

Head to [Troubleshooting](/troubleshooting). An old Node.js version and a port that's already taken cause most problems.
