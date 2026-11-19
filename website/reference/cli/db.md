---
title: selfauth db
description: Review and apply database migrations with the native tool. status, plan, migrate, validate, rollback and generate for Prisma, MongoDB and Go projects, with expected output and safety rules.
keywords: [selfauth db, migrate, prisma migrate, db plan, db status, approve-destructive, rollback, go migrate, mongodb indexes]
---

# `selfauth db`

Wraps your project's native migration tool (Prisma Migrate for PostgreSQL, MySQL and SQLite, the index script for MongoDB, the Go runner for Gin) and adds a safety review on top. SelfAuth never migrates when the server starts.

```text
selfauth db <command> [--dir <dir>]
```

`--dir` is the project directory and defaults to the current folder. The commands read `DATABASE_URL` from the environment or from the project's `.env` (`server/.env` in a full-stack project).

## Commands

| Command | What it does |
| --- | --- |
| `status` | Shows applied and pending migrations |
| `plan` | Reviews pending migrations for statements that lose data and for changes to SelfAuth's own tables. Changes nothing |
| `migrate [--approve-destructive]` | Applies pending migrations. Refuses anything `plan` flags unless you pass the flag |
| `validate` | Checks the schema against the ownership manifest |
| `rollback` | Explains how to roll back. There are no automatic down migrations |
| `generate <name>` | Creates a migration from changes to your schema, without applying it (Prisma projects) |

## Examples with real output

```bash
npx selfauth db plan
```

```text
Pending migrations (1):
  • 20261116085533_selfauth_init  (prisma/migrations/20261116085533_selfauth_init/migration.sql)
  ✓ Nothing here loses data or touches SelfAuth's tables.
```

```bash
npx selfauth db migrate
```

```text
Pending migrations (1):
  • 20261116085533_selfauth_init  (prisma/migrations/20261116085533_selfauth_init/migration.sql)
  ✓ Nothing here loses data or touches SelfAuth's tables.
  ✓ Migrations applied.
```

```bash
npx selfauth db status
```

```text
  ✓ Database is up to date.
```

```bash
npx selfauth db validate
```

```text
  ✓ Schema and ownership manifest are valid.
```

```bash
npx selfauth db rollback
```

```text
  • Prisma Migrate has no automatic down migrations. Restore from a backup taken before migrating, or write a new forward migration that reverts the change. To recover a failed migration, fix the database and run `prisma migrate resolve --rolled-back <name>`.
```

## By database

| Project | `status` | `plan` | `migrate` | `generate` |
| --- | --- | --- | --- | --- |
| PostgreSQL, MySQL, SQLite (Prisma) | `prisma migrate status` | Analyses the SQL | `prisma migrate deploy` | Creates `prisma/migrations/<time>_<name>/migration.sql` |
| MongoDB | Runs the index script in plan mode | Lists the indexes it would create | Creates missing indexes, never drops one | not applicable (`validate`, `rollback` and `generate` just explain this) |
| Gin (Go), PostgreSQL, MySQL, SQLite | Runs `go run ./cmd/migrate status` | Analyses the SQL in `db/migrations/`, the same way | Reviews, then runs `go run ./cmd/migrate up` | not applicable: write the SQL by hand |
| Gin (Go), MongoDB | Lists the indexes `migrate` would create | The same | Runs `go run ./cmd/migrate up`, which creates missing indexes | not applicable |
| In-memory | – | – | – | – |

An in-memory project just says: `✗ database commands need a database: this project uses 'memory'.`

## The safety review

`db plan` and `db migrate` read the SQL of every pending migration. `migrate` refuses to run when the plan has findings, unless you add `--approve-destructive`. What counts as a finding depends on what the statement does and whose migration it is.

**Your own migrations** (the ones you create with `db generate`) can do what they like to your own tables, as long as they don't lose data. Creating a table, adding a column or adding an index goes straight through, with nothing to approve. You're stopped for:

| Finding | Example | What it says |
| --- | --- | --- |
| Dropping a table, column, type or schema | `DROP TABLE`, `DROP COLUMN` | Deletes data |
| Removing rows | `TRUNCATE`, `DELETE` | Deletes data |
| Changing a column in a risky way | changing a column type, `SET NOT NULL`, renaming | Existing data may not fit, or code that uses the old name breaks |
| Dropping a constraint or an index | `DROP CONSTRAINT`, `DROP INDEX` | Removes a rule or slows queries down |
| `selfauth_table` | any statement on a table listed in `selfauth.manifest.json` under `ownedResources` (the `auth_…` tables) | Changes a table SelfAuth owns, which can break `selfauth upgrade` |
| Creating an object that already exists in the database | a baseline problem | Nothing is applied |

The data-loss findings apply to every table, yours or SelfAuth's.

**SelfAuth's own migrations** (listed under `ownedResources.migrations` in the manifest, such as the ones an upgrade adds) are held to the opposite rule: they may only change SelfAuth's tables. A SelfAuth migration that touches any other table is reported as `not_owned`. That's the guarantee behind "SelfAuth never touches your tables": a release can't quietly alter `notes`, or `orders`, or anything else of yours.

Each finding is printed with a sentence saying what it means. For example:

```text
Changes that need explicit approval:
  ⚠ [destructive] selfauth_table auth_users — 20261119095926_user_nickname:2
      changes a table SelfAuth owns (auth_…); that can break `selfauth upgrade`
```

## Rules

- Read the SQL before you apply it, and back up before migrating production.
- Run migrations as a deploy step, not when the app starts.
- There are no down migrations. Restore a backup or write a new forward migration.
- A database that wasn't created with Prisma fails with `P3005`. Baseline it with `prisma migrate resolve --applied <migration>`, and only for migrations whose objects really exist.

## Troubleshooting

[Troubleshooting](/help/troubleshooting#database-url-is-not-set) covers `DATABASE_URL is not set`, special characters in passwords, and pooled databases such as Supabase.
