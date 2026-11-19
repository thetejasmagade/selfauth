---
title: "3. Find your way around"
description: The files in a generated Gin (Go) project, which ones you'll change, which ones to leave alone, and the commands you'll use.
keywords: [gin project structure, go project layout, selfauth files, routes.go, selfauth.config.json, db/migrations]
---

# 3. Find your way around

Here's what you got. You'll only change a handful of these files, marked ★.

```text
notes-app/
├── cmd/
│   ├── server/main.go          starts everything, in order
│   ├── migrate/main.go         applies db/migrations (selfauth db migrate runs it)
│   ├── seed/main.go            writes roles and permissions to the database
│   └── create-admin/main.go    makes an account an administrator
├── internal/
│   ├── routes/
│   │   ├── routes.go           ★ your endpoints
│   │   └── routes_test.go      ★ tests for them (chapter 10)
│   ├── email/mailer.go         ★ connects your email provider (chapter 11)
│   ├── app/                    builds the Gin router
│   ├── config/                 reads selfauth.config.json and the environment
│   ├── httpx/                  error responses, request ids, body limit
│   ├── auth/                   SelfAuth's core: read it, don't change it
│   ├── ginauth/                SelfAuth for Gin: cookies, CSRF, the /auth routes, guards
│   └── store/                  opens the database
├── db/
│   └── migrations/             ★ one folder per database change, plain SQL
├── selfauth.config.json        ★ roles, permissions, password rules, session length
├── .env                        your local settings, never committed
├── go.mod
└── selfauth.manifest.json      a record of what SelfAuth generated
```

## The files that matter

**`internal/routes/routes.go`** is where your endpoints go. The `Register` function in it is called once, after SelfAuth's middleware has been added, so every endpoint you add there already knows who's signed in. It receives three things:

| | What it is |
| --- | --- |
| `r` | The Gin engine |
| `a` | SelfAuth: the guards that protect routes, and `a.Context(c)` to find out who's calling |
| `db` | The database, for your own tables: `db.SQL` (a `*sql.DB`) on PostgreSQL, MySQL and SQLite, or `db.Mongo` on MongoDB. Both are nil if the app runs without a database. |

**`selfauth.config.json`** holds every setting: which permissions exist, which role gets which, how long sessions last, how long passwords must be. Changing behavior almost always means changing this file, not code. The [configuration reference](/reference/config-file) lists everything.

**`db/migrations/`** holds your database changes as plain SQL files, one folder each. SelfAuth's own tables are in the first one. You'll add yours in [chapter 6](./add-a-table).

**`internal/auth/`** is the security core: password hashing, sessions, rate limits. It's tested by SelfAuth's suite of security checks. Read it as much as you like, but if you change it, you're on your own. `npx selfauth validate` tells you if a file there has changed.

## How a request flows

`cmd/server/main.go` is short and worth reading. It does this, in order:

1. reads and checks the environment variables,
2. loads `selfauth.config.json`,
3. opens the database,
4. creates SelfAuth,
5. builds the router and calls your `Register`,
6. starts listening.

In the router, a request passes through the request id, error recovery, the body limit, SelfAuth's middleware (session and CSRF), and then the routes: `/health`, `/auth/...`, then yours. If nothing matches, it gets a `404`.

## The commands

| Command | What it does |
| --- | --- |
| `go run ./cmd/server` | Starts the server. Stop it with Ctrl+C and start it again after a change. |
| `go test ./...` | Runs every test |
| `go vet ./...` | Finds common mistakes without running anything |
| `go build -o bin/server ./cmd/server` | Builds the server for production |
| `go run ./cmd/seed` | Writes roles and permissions to the database |
| `go run ./cmd/create-admin you@example.com` | Makes an account an administrator |

And the `selfauth` commands you'll use most:

| Command | What it does |
| --- | --- |
| `npx selfauth db plan` | Shows which migrations would run, and warns about risky ones |
| `npx selfauth db migrate` | Applies them |
| `npx selfauth validate` | Checks your configuration and which generated files you changed |
| `npx selfauth doctor` | Checks whether you're ready for production |

The `go run` commands read your settings from the environment, so load `.env` first (chapter 1). The `selfauth db` commands find `DATABASE_URL` in `.env` by themselves.

## Check it worked

Open `internal/routes/routes.go`. You should see `func Register(r *gin.Engine, a *ginauth.Auth, db store.DB)` and the `/hello` endpoint you called in the last chapter. That's where you'll work next.

Next: [Add endpoints](./endpoints)
