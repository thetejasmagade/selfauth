---
title: Quick start
description: Create a SelfAuth project, run it and see it work in ten minutes. Step-by-step commands with expected output for Express, with Gin and full-stack variants.
keywords: [quick start, getting started, install, selfauth init, npx selfauth, run first project]
---

# Quick start

In about ten minutes you will generate a project, start it and sign in. This page uses **Express with the in-memory store**, because it needs nothing but Node.js. The [Gin](#variant-gin-go) and [Vue/React](#variant-with-a-frontend) variants are at the end.

::: info Real and illustrative output
Blocks labelled **Output** were captured from a real run of this version. Values that differ on every run (ids, tokens, timestamps) are shown as they were captured, and yours will differ.
:::

## Before you start

Check that [Node.js 22.18 or newer](./prerequisites) is installed:

```bash
node --version
```

## Step 1: Generate the project

```bash
npx selfauth init my-app --database memory --permissions orders.view,orders.create -y
```

What the parts mean:

| Part | Meaning |
| --- | --- |
| `npx selfauth init my-app` | Create a new project in a new folder called `my-app` |
| `--database memory` | Use the in-memory store (no database server) |
| `--permissions orders.view,orders.create` | Declare two permissions your app will use later |
| `-y` | Do not ask questions: accept the plan |

Leave out the flags and the command asks you each question instead (arrow keys, or a number). It also shows the list of files and asks before writing anything.

**Output** (the list of files is shortened here to the summary lines):

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

This installs Express and the Argon2 password hashing library. Nothing from SelfAuth is installed, because the generated code does not depend on it.

## Step 3: Create your settings file

```bash
cp .env.example .env
```

On Windows Command Prompt use `copy .env.example .env`.

`.env` holds your environment variables. The defaults are right for local development:

```ini
NODE_ENV=development
PORT=3000
SELFAUTH_APP_BASE_URL=http://localhost:5173
```

`SELFAUTH_APP_BASE_URL` is the address of your **frontend**. It is only used to build the links in verification and password-reset emails. See [Environment variables](/configuration/environment).

## Step 4: Start the server

```bash
npm run dev
```

**Output:**

```text
> my-app@0.1.0 dev
> node --env-file-if-exists=.env --watch src/server.ts

Using in-memory store.
Listening on http://localhost:3000
```

The server restarts when you save a file. Leave it running and open a **second terminal** for the next steps.

## Step 5: Check that it is alive

```bash
curl -i http://localhost:3000/health
```

**Output:**

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

**Output:**

```text
HTTP/1.1 401 Unauthorized
...
{"error":{"code":"UNAUTHENTICATED","message":"Authentication required.","requestId":"4f9b2df3-8a60-45ba-a5c0-b8a144b03d3a"}}
```

A request without a session is refused with the error code `UNAUTHENTICATED`. To sign in and get through, continue with [Try the authentication flow](./first-flow).

## Step 7: Run the tests

The project ships with tests for its authentication wiring. They need no database.

```bash
npm test
```

**Output** (end of the report):

```text
# tests 6
# suites 1
# pass 6
# fail 0
```

## Step 8: Check the project

The CLI can check the project's health. This is optional and only needs to be run on your computer:

```bash
npx selfauth doctor
```

**Output:**

```text
SelfAuth doctor → /home/you/my-app
  ⚠ in-memory store: data is lost on restart; use PostgreSQL, MySQL, SQLite or MongoDB in production
  ⚠ no email provider yet: implement createMailer() in src/email/mailer.ts before production
  • templates 0.15.0, spec 0.1, database memory

0 error(s), 2 warning(s).
```

The two warnings are the to-do list before production. See [Going to production](/advanced/production).

## Variant: with a frontend

```bash
npx selfauth init my-app --database memory --frontend vue -y
cd my-app
npm install                  # one install covers server/ and client/
cp server/.env.example server/.env
npm run dev                  # API on :3000 and the Vue app on :5173
```

Open `http://localhost:5173`. You get working **Sign in**, **Create account**, **Verify email**, **Forgot password** and **Account** pages. Use `--frontend react` for React. The folders are explained in [Full stack: Vue or React](/structure/full-stack).

## Variant: Gin (Go)

You need Go 1.26 or newer.

```bash
npx selfauth init my-api --backend gin --database memory --module github.com/you/my-api -y
cd my-api
export SELFAUTH_APP_BASE_URL=http://localhost:5173
go run ./cmd/server
```

**Output:**

```text
2026/11/18 11:38:21 Using in-memory store (set DATABASE_URL to use PostgreSQL).
2026/11/18 11:38:21 Listening on http://localhost:3000
```

A Gin server reads **environment variables from the process**. It does not load a `.env` file by itself, which is why `export` is used. On Windows PowerShell use `$env:SELFAUTH_APP_BASE_URL="http://localhost:5173"`. Run the server from the project folder, because it reads `selfauth.config.json` from the current directory. See [Gin (Go) API](/structure/gin).

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

Details are in [`selfauth db`](/cli/db) and [What each database changes](/structure/databases).

## If something fails

See [Troubleshooting](/troubleshooting). The most common causes are an old Node.js version and a port already in use.

## Next

- [Try the authentication flow](./first-flow)
