---
title: "1. Create your project"
description: Generate a Fastify project with SelfAuth, install its dependencies, create the database and seed the roles.
keywords: [selfauth init, fastify, create project, sqlite, npm install, db migrate, db seed]
---

# 1. Create your project

## Generate it

Open a terminal in the folder where you keep your projects and run:

```bash
npx selfauth@latest init notes-app --backend fastify --database sqlite --frontend none
```

`notes-app` is the name of the new folder, and it's also the project's name. SelfAuth shows you the list of files it's about to create and writes them. It takes a few seconds.

If you leave out the options, `npx selfauth@latest init notes-app` asks you the same questions one at a time.

::: details Using PostgreSQL, MySQL or MongoDB instead?
Change `--database`:

```bash
npx selfauth@latest init notes-app --backend fastify --database postgresql --frontend none
```

The values are `postgresql`, `mysql`, `sqlite`, `mongodb` and `memory`. You'll need an empty database ready, and in the next step you'll put its address in `.env`.
:::

::: details Want React or Vue pages too?
Use `--frontend react` or `--frontend vue`. Your project then has two folders: `server/` holds the Fastify API and `client/` holds the pages. Every file this guide mentions is inside `server/`, so `src/routes/index.ts` becomes `server/src/routes/index.ts`. Run the `npm` and `npx selfauth` commands from the top `notes-app` folder, as written.
:::

## Install and set up the database

```bash
cd notes-app
npm install
```

Next, create your settings file by copying the example:

::: code-group

```bash [macOS / Linux]
cp .env.example .env
```

```powershell [Windows PowerShell]
Copy-Item .env.example .env
```

:::

`.env` holds settings that differ between your computer and production: the port, your frontend's address, and the database address. For SQLite it already points at a file called `app.db`, so you don't need to change anything.

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

Now create the tables SelfAuth needs. First look at what will happen:

```bash
npx selfauth db plan
```

```text
Pending migrations (1):
  • 20261116085533_selfauth_init  (prisma/migrations/20261116085533_selfauth_init/migration.sql)
  ✓ Nothing here loses data or touches SelfAuth's tables.
```

A *migration* is a file of SQL that changes the database. This one creates SelfAuth's tables: users, sessions, roles and so on. `plan` reads it and tells you whether it would lose any data. It wouldn't, so apply it:

```bash
npx selfauth db migrate
```

Then write the roles from your configuration into the database:

```bash
npm run db:seed
```

```text
Synchronized roles: user, admin
```

::: tip MongoDB
MongoDB has no SQL migrations. `npx selfauth db migrate` creates the indexes SelfAuth needs instead (the one that keeps emails unique, for example). The commands are the same.
:::

## Check it worked

```bash
npx selfauth validate
```

The last line should be `All checks passed.` You now have a working Fastify API with sign-up and sign-in. Next you'll start it and try it.

## If something went wrong

- **`npm install` failed on Windows with no explanation.** Older versions of the CLI couldn't start npm on Windows. Run `npm install` yourself inside `notes-app`. The generated files are fine.
- **`DATABASE_URL is not set`.** You skipped copying `.env.example` to `.env`, or you ran the command outside the `notes-app` folder.
- **`Can't reach database server`** (PostgreSQL, MySQL). The database isn't running, or the address, user or password in `DATABASE_URL` is wrong.

Next: [Run it and sign in](./run-and-sign-in)
