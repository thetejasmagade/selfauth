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
| `plan` | Reviews pending migrations for destructive statements and changes to tables SelfAuth does not own. Changes nothing |
| `migrate [--approve-destructive]` | Applies pending migrations. Refuses destructive or non-owned changes unless you pass the flag |
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
  ✓ No destructive or non-owned changes.
```

```bash
npx selfauth db migrate
```

```text
Pending migrations (1):
  • 20261116085533_selfauth_init  (prisma/migrations/20261116085533_selfauth_init/migration.sql)
  ✓ No destructive or non-owned changes.
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
| Gin (Go) | Runs `go run ./cmd/migrate status` | Not analysed: read each `migration.sql` yourself | Runs `go run ./cmd/migrate up` | not applicable: write SQL by hand |
| In-memory | – | – | – | – |

An in-memory project just says: `✗ database commands need a database: this project uses 'memory'.`

## The safety review

`db plan` and `db migrate` read the SQL of every pending migration. The review errs on the side of caution: unless you add `--approve-destructive`, `migrate` refuses when a statement could lose data, rewrite a table or touch something SelfAuth does not own. It looks for:

| Finding | Example |
| --- | --- |
| Dropping a table, column, type or schema | `DROP TABLE`, `DROP COLUMN` |
| Removing rows | `TRUNCATE`, `DELETE` |
| Changing a column in a risky way | changing a column type, `SET NOT NULL`, renaming |
| Dropping a constraint or an index | `DROP CONSTRAINT`, `DROP INDEX` |
| Touching an object that is not owned by SelfAuth | any statement on a table not listed in `selfauth.manifest.json` under `ownedResources` |
| Creating an object that already exists in the database | a baseline problem |

That's what stops a teammate's migration, an upgrade or an ORM-generated change from quietly damaging data.

## Rules

- Read the SQL before you apply it, and back up before migrating production.
- Run migrations as a deploy step, not when the app starts.
- There are no down migrations. Restore a backup or write a new forward migration.
- A database that wasn't created with Prisma fails with `P3005`. Baseline it with `prisma migrate resolve --applied <migration>`, and only for migrations whose objects really exist.

## Troubleshooting

[Troubleshooting](/troubleshooting#database-url-is-not-set) covers `DATABASE_URL is not set`, special characters in passwords, and pooled databases such as Supabase.
