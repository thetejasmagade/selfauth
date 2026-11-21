---
title: "1. Create your project"
description: Generate a Flask (Python) project with SelfAuth, create a virtual environment, load its settings, create the database and seed the roles.
keywords: [selfauth init, flask, python, venv, pip, create project, sqlite, db migrate, seed]
---

# 1. Create your project

## Generate it

Open a terminal in the folder where you keep your projects and run:

```bash
npx selfauth@latest init notes-app --backend flask --database sqlite --frontend none
```

`notes-app` is the name of the new folder. SelfAuth shows you the list of files it's about to create and writes them. If you leave out the options, `npx selfauth@latest init notes-app` asks you the same questions one at a time.

::: details Using PostgreSQL, MySQL or MongoDB instead?
Change `--database`:

```bash
npx selfauth@latest init notes-app --backend flask --database postgresql --frontend none
```

The values are `postgresql`, `mysql`, `sqlite`, `mongodb` and `memory`. You'll need an empty database ready, and in the next step you'll put its address in `.env`. The project installs only the Python library for the database you chose.
:::

## A virtual environment

Python projects keep their libraries in a *virtual environment*, a folder that belongs to this project alone. Create one and install what the project needs:

::: code-group

```bash [macOS / Linux]
cd notes-app
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

```powershell [Windows PowerShell]
cd notes-app
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
```

:::

`requirements.txt` lists what the server needs (Flask, an Argon2 library for passwords, a production web server and your database's driver). `requirements-dev.txt` adds `pytest` for the tests. Your prompt now starts with `(.venv)`. Every command in this guide assumes the environment is active.

## Your settings

Create your settings file by copying the example:

::: code-group

```bash [macOS / Linux]
cp .env.example .env
```

```powershell [Windows PowerShell]
Copy-Item .env.example .env
```

:::

`.env` holds settings that differ between your computer and production: the port, your frontend's address, and the database address. For SQLite, check that `DATABASE_URL=file:./app.db` is there. The server reads `.env` by itself when it starts; settings you've already put in your shell win over the file.

::: details The DATABASE_URL for other databases
```ini
DATABASE_URL=postgresql://user:password@localhost:5432/notes
DATABASE_URL=mysql://user:password@localhost:3306/notes
DATABASE_URL=mongodb://localhost:27017/notes
```
:::

## Create SelfAuth's tables and roles

```bash
python -m app.cmd.migrate status
python -m app.cmd.migrate up
python -m app.cmd.seed
```

```text
applied: []
pending: [20261116085533_selfauth_init]
Applied: [20261116085533_selfauth_init]
Synchronized roles: ['admin', 'user']
```

`migrate up` creates SelfAuth's tables (they all start with `auth_`). `seed` writes the roles and permissions from `selfauth.config.json` into the database. The server never does either by itself, so you decide when your database changes.

## Check it worked

```bash
python -m app.cmd.migrate status
```

```text
applied: [20261116085533_selfauth_init]
pending: []
```

Next: [Run it and sign in](./run-and-sign-in)
