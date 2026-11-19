---
title: selfauth init
description: Create a new SelfAuth project. Every option of selfauth init with defaults, the interactive questions, examples for each backend, database and frontend, and the expected output.
keywords: [selfauth init, create project, --backend, --database, --frontend, --permissions, --module, --dry-run, wizard]
---

# `selfauth init`

Creates a new project in a folder. The folder can be empty or not exist yet, but it can't already contain a `package.json`, a `go.mod` or a SelfAuth manifest. For an existing project, use [`add`](./add).

```text
selfauth init [dir] [options]
```

## Interactive or not

Run it with no options in a terminal and it asks you everything: the folder, backend, database, frontend permissions, the address of your frontend (API-only projects), the Go module path (Gin), and whether to run `npm install`. Use the arrow keys or type a number. If an answer is bad it tells you why and asks again. Ctrl-C cancels and writes nothing. Before writing anything it shows the list of files and asks you to confirm.

Each option below answers its question in advance, so you only get asked about what you left out. With `--yes`, or when there's no terminal (CI, scripts, agents), nothing is asked and the defaults fill in whatever you didn't give.

## Options

| Option | Values | Default | Meaning |
| --- | --- | --- | --- |
| `[dir]` | a folder name | asked, or `.` if the current folder is empty | Where to create the project. The folder name becomes the project name |
| `--backend <framework>` | `express`, `fastify`, `gin` | `express` | The web framework |
| `--database <db>` | `postgresql`, `mysql`, `sqlite`, `mongodb`, `memory` | `postgresql` | The data store. Works with every backend |
| `--frontend <fw>` | `none`, `vue`, `react` | `none` | Generate a frontend into `client/`. With Gin the Go module moves into `server/` |
| `--permissions <list>` | comma-separated, such as `orders.view,orders.create` | none | Declares your application permissions in the configuration. They are not given to any role: see [Permissions and roles](/express/permissions) |
| `--app-base-url <url>` | an `http` or `https` address | `http://localhost:5173` | Frontend address used in email links |
| `--module <path>` | a Go module path, such as `github.com/you/my-api` | the project name | Gin only. Used in `go.mod` and all imports |
| `-y`, `--yes` | – | – | Do not ask; accept the plan |
| `--dry-run` | – | – | Print the plan and write nothing |
| `--install` | – | asked (default yes) in the wizard; no with `--yes` | Run `npm install` afterwards. Not used for Gin |

Permission names have to follow the [naming rules](/express/permissions), and a bad one is refused.

## Examples

To try SelfAuth with no database:

```bash
npx selfauth init my-app --database memory -y
```

An API on PostgreSQL:

```bash
npx selfauth init my-api --database postgresql --permissions orders.view,orders.create -y
```

A full-stack project on Fastify with Vue:

```bash
npx selfauth init my-app --backend fastify --database postgresql --frontend vue -y
```

A Go project:

```bash
npx selfauth init my-api --backend gin --database postgresql --module github.com/you/my-api -y
```

To see the plan first:

```bash
npx selfauth init my-app --dry-run -y
```

## Expected output

An API-only Express project on the in-memory store (real output, with the file list trimmed):

```text
SelfAuth init → /home/you/my-app

Plan: create 34 files (Express + in-memory store)
  + src/auth/types.ts
  + src/auth/index.ts
  ...
  ✓ Created 34 files and selfauth.manifest.json

Next steps:
  cd my-app
  npm install
  cp .env.example .env
  npm run dev

Before production: implement createMailer() in src/email/mailer.ts, then run `npx selfauth doctor`.
```

A full-stack project:

```text
  ✓ Created 67 files: server/ (API), client/ (vue) and a workspace root. Each package has its own selfauth.manifest.json.

Next steps:
  cd my-app
  npm install               # installs server/ and client/
  cp server/.env.example server/.env   # set DATABASE_URL
  npx selfauth db plan      # review the migration first
  npm run db:migrate && npm run db:seed
  npm run dev               # API and vue app together; open http://localhost:5173
```

A Gin project:

```text
  ✓ Created 45 files and selfauth.manifest.json

Next steps:
  cd my-api
  export SELFAUTH_APP_BASE_URL=http://localhost:5173   # the server reads the environment, not .env
  go run ./cmd/server

Before production: implement NewMailer in internal/email/mailer.go, then run `npx selfauth doctor`.
```

The number of files depends on the options you chose.

## What gets created

| You chose | You get | Page |
| --- | --- | --- |
| Express or Fastify, no frontend | one package with `src/` at the root | [Express API](/express/project-tour) |
| with `--frontend` | `server/` and `client/` in one npm workspace | [Full stack](/express/frontend-page) |
| Gin | a Go module | [Gin (Go)](/gin/) |

## Common errors

| Message | Cause | Fix |
| --- | --- | --- |
| `This directory already contains a SelfAuth project (selfauth.manifest.json).` | Already initialized | Use another folder, or `upgrade` |
| `This directory already has a package.json.` | The folder holds a Node project | Use [`selfauth add`](./add), or an empty folder |
| `This directory already has a go.mod.` | The folder holds a Go project | Use an empty folder: `init` creates new projects only |
| An error about the Go module path | The `--module` value is not a valid module path | Use a path like `github.com/you/my-api` |
| An error about the database for Gin | Gin supports PostgreSQL and memory only | Use `--database postgresql` or `memory` |
