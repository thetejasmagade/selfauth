---
title: "1. Create your project"
description: Generate a Gin (Go) project with SelfAuth, load its settings into your terminal, create the database and seed the roles.
keywords: [selfauth init, gin, go, create project, sqlite, go run, db migrate, seed]
---

# 1. Create your project

## Generate it

Open a terminal in the folder where you keep your projects and run:

```bash
npx selfauth@latest init notes-app --backend gin --database sqlite --frontend none
```

`notes-app` is the name of the new folder. It's also the Go module name, so your imports will read `notes-app/internal/...`. To use a module path like `github.com/you/notes-app`, add `--module github.com/you/notes-app`.

SelfAuth shows you the list of files it's about to create and writes them. If you leave out the options, `npx selfauth@latest init notes-app` asks you the same questions one at a time.

::: details Using PostgreSQL, MySQL or MongoDB instead?
Change `--database`:

```bash
npx selfauth@latest init notes-app --backend gin --database postgresql --frontend none
```

The values are `postgresql`, `mysql`, `sqlite`, `mongodb` and `memory`. You'll need an empty database ready, and in the next step you'll put its address in `.env`.
:::

::: details Want React or Vue pages too?
Use `--frontend react` or `--frontend vue`. Your project then has two folders: `server/` holds the Go code and `client/` holds the pages. Every Go file this guide mentions is inside `server/`, so `internal/routes/routes.go` becomes `server/internal/routes/routes.go`. Run `go` commands inside `server/`. [Chapter 9](./frontend-page) explains the rest.
:::

## Your settings

```bash
cd notes-app
```

Create your settings file by copying the example:

::: code-group

```bash [macOS / Linux]
cp .env.example .env
```

```powershell [Windows PowerShell]
Copy-Item .env.example .env
```

:::

`.env` holds settings that differ between your computer and production: the port, your frontend's address, and the database address. For SQLite it already points at a file called `app.db`.

::: details The DATABASE_URL for other databases
Open `.env` and set `DATABASE_URL` to your database:

```ini
# PostgreSQL
DATABASE_URL=postgresql://postgres:secret@localhost:5432/notes
# MySQL
DATABASE_URL=mysql://root:secret@localhost:3306/notes
# MongoDB
DATABASE_URL=mongodb://localhost:27017/notes
```
:::

### Load them into your terminal

Here's one difference from the Node backends: the Go server reads settings from the environment, and doesn't open `.env` by itself. So load the file into your terminal:

::: code-group

```bash [macOS / Linux]
set -a; source .env; set +a
```

```powershell [Windows PowerShell]
Get-Content .env | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object { $k, $v = $_ -split '=', 2; Set-Item "env:$k" $v }
```

:::

You need to do this once in every new terminal window. If a command later says `DATABASE_URL is required`, this is the step you missed.

## Create the database

Create the tables SelfAuth needs. First look at what will happen:

```bash
npx selfauth db plan
```

```text
Pending migrations (1):
  • 20261116085533_selfauth_init  (db/migrations/20261116085533_selfauth_init/migration.sql)
  ✓ Nothing here loses data or touches SelfAuth's tables.
```

A *migration* is a file of SQL that changes the database. This one creates SelfAuth's tables: users, sessions, roles and so on. `plan` reads it and tells you whether it would lose any data. It wouldn't, so apply it:

```bash
npx selfauth db migrate
```

```text
Applied: [20261116085533_selfauth_init]
  ✓ Migrations applied.
```

Then write the roles from your configuration into the database:

```bash
go run ./cmd/seed
```

```text
Synchronized roles: [admin user]
```

The first `go run` downloads the project's dependencies, so it takes a minute. After that it's quick.

::: tip MongoDB
MongoDB has no SQL migrations. `npx selfauth db migrate` creates the indexes SelfAuth needs instead (the one that keeps emails unique, for example). The commands are the same.
:::

## Email setup

SelfAuth sends two kinds of email: the link to verify an address after sign-up, and the link to reset a password. **You don't have to set anything up yet.** In development nothing is sent: each email is printed in the terminal where the server runs, one-time link included, so you can click it yourself. You'll see this in the next chapter.

Real email is needed before production, because the server refuses to start in production without a mailer. The mailer is one small file you own, `internal/email/mailer.go` (`server/internal/email/mailer.go` if you chose a frontend).
For real email, pick a provider ([Resend](/email/resend) is the quickest to start with), replace the mailer file with the code on its page and set the variables it lists. For Resend that is two variables in your terminal, in the same place you set `DATABASE_URL`:

```bash
export RESEND_API_KEY=re_your_key_here
export MAIL_FROM="Notes <login@mail.example.com>"
```

With a key set, every email goes through the provider, in development too. Unset them to go back to printing emails in the terminal.

That's all you need to know for now. For every provider, the variables each one needs, testing your mailer and fixing delivery problems, see the [detailed email setup guide](/email/).

## Check it worked

```bash
npx selfauth validate
```

The last line should be `All checks passed.` You now have a working Go API with sign-up and sign-in. Next you'll start it and try it.

## If something went wrong

- **`DATABASE_URL is required`** or **`DATABASE_URL is not set`.** Load `.env` into your terminal (above), in this terminal window.
- **`go: command not found`.** Go isn't installed, or isn't on your `PATH`. Open a new terminal after installing it.
- **`Can't reach database server`** or **`connection refused`** (PostgreSQL, MySQL, MongoDB). The database isn't running, or the address, user or password in `DATABASE_URL` is wrong.

Next: [Run it and sign in](./run-and-sign-in)
