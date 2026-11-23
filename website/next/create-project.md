---
title: "1. Create your project"
description: Generate a Next.js project with SelfAuth, install its dependencies, create the database and seed the roles.
keywords: [selfauth init, next.js, create project, sqlite, npm install, db migrate, db seed]
---

# 1. Create your project

## Generate it

Open a terminal in the folder where you keep your projects and run:

```bash
npx selfauth@latest init notes-app --backend next --database sqlite --frontend next
```

`notes-app` is the name of the new folder, and it's also the project's name. SelfAuth shows you the list of files it's about to create and writes them. It takes a few seconds.

If you leave out the options, `npx selfauth@latest init notes-app` asks you the same questions one at a time.

::: details Using PostgreSQL, MySQL or MongoDB instead?
Change `--database`:

```bash
npx selfauth@latest init notes-app --backend next --database postgresql --frontend next
```

The values are `postgresql`, `mysql`, `sqlite`, `mongodb` and `memory`. You'll need an empty database ready, and in the next step you'll put its address in `.env`.
:::

::: details Want the API without pages, or a Vue or React frontend?
Use `--frontend none` for the API only. `--frontend react` or `--frontend vue` makes two folders: `server/` holds the Next.js API (no pages) and `client/` holds a Vite app. Every file this guide mentions is then inside `server/`, so `src/app/api/hello/route.ts` becomes `server/src/app/api/hello/route.ts`. Run the `npm` and `npx selfauth` commands from the top `notes-app` folder, as written.
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

`.env` holds settings that differ between your computer and production: the port, your app's address, and the database address. Next.js reads it by itself. For SQLite it already points at a file called `app.db`, so you don't need to change anything.

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

## Email setup

SelfAuth sends two kinds of email: the link to verify an address after sign-up, and the link to reset a password. **You don't have to set anything up yet.** In development nothing is sent: each email is printed in the terminal where the server runs, one-time link included, so you can click it yourself. You'll see this in the next chapter.

Real email is needed before production, because the server refuses to start in production without a mailer. The mailer is one small file you own, `src/email/mailer.ts` (`server/src/email/mailer.ts` if you chose a Vite frontend).
For real email, pick a provider ([Resend](/email/resend) is the quickest to start with), replace the mailer file with the code on its page and set the variables it lists. For Resend that is two lines in `.env` (`server/.env` with a Vite frontend):

```ini
RESEND_API_KEY=re_your_key_here
MAIL_FROM=Notes <login@mail.example.com>
```

With a key set, every email goes through the provider, in development too. Remove the lines to go back to printing them in the terminal.

That's all you need to know for now. For every provider, the variables each one needs, testing your mailer and fixing delivery problems, see the [detailed email setup guide](/email/).

## Check it worked

```bash
npx selfauth validate
```

The last line should be `All checks passed.` You now have a working Next.js app with sign-up and sign-in. Next you'll start it and try it.

## If something went wrong

- **`npm install` failed on Windows with no explanation.** Older versions of the CLI couldn't start npm on Windows. Run `npm install` yourself inside `notes-app`. The generated files are fine.
- **`DATABASE_URL is not set`.** You skipped copying `.env.example` to `.env`, or you ran the command outside the `notes-app` folder.
- **`Can't reach database server`** (PostgreSQL, MySQL). The database isn't running, or the address, user or password in `DATABASE_URL` is wrong.

Next: [Run it and sign in](./run-and-sign-in)
