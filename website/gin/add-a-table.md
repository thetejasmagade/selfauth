---
title: "6. Add a table"
description: Add your own notes table to a Gin (Go) SelfAuth project with a plain SQL migration for SQLite, PostgreSQL or MySQL, review it with selfauth db plan and apply it. With the MongoDB equivalent.
keywords: [go migration, sql migration, db/migrations, selfauth db plan, db migrate, add table, mongodb index, gin]
---

# 6. Add a table

Notes need somewhere to live. In this chapter you'll create a `notes` table, using the same migration tools you used for SelfAuth's own tables in chapter 1.

A Go project keeps its migrations as plain SQL files, which you write yourself. The workflow is:

1. **Write** the SQL in a new folder under `db/migrations/`.
2. **Review** it with `npx selfauth db plan`.
3. **Apply** it with `npx selfauth db migrate`.

## Write the migration

Each migration is a folder holding one file, `migration.sql`. Migrations run in the order of their folder names, so start the name with the date and time, then say what it does:

```text
db/migrations/20261119120000_add_notes/migration.sql
```

Use today's date and time: `YYYYMMDDHHMMSS`. Then write the SQL for your database:

::: code-group

```sql [SQLite]
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX notes_owner_id_idx ON notes (owner_id);
```

```sql [PostgreSQL]
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notes_owner_id_idx ON notes (owner_id);
```

```sql [MySQL]
CREATE TABLE notes (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  owner_id CHAR(36) NOT NULL,
  text TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE INDEX notes_owner_id_idx ON notes (owner_id);
```

:::

Line by line:

- `notes` is the table's name. Lowercase plural is the usual style, and it keeps clear of SelfAuth's tables, which all start with `auth_`.
- `owner_id` holds the id of the user who wrote the note.
- `created_at` records when, so you can show the newest first.
- The index makes "find this user's notes" fast, even with millions of rows.

::: details MongoDB
MongoDB doesn't need a migration for a new collection. It appears the first time you save a document. You only need the index on `ownerId`: open `cmd/migrate/main.go`, and just after the `store.Migrate(...)` call and its error check, add:

```go
// Your own indexes (MongoDB only): created here, with SelfAuth's, never when the server starts.
if database == "mongodb" {
	conn, err := store.Connect(ctx, database, url)
	if err != nil {
		return err
	}
	defer conn.Close()
	notes := conn.DB.Mongo.Collection("notes")
	if _, err := notes.Indexes().CreateOne(ctx, mongo.IndexModel{Keys: bson.D{{Key: "ownerId", Value: 1}}}); err != nil {
		return err
	}
}
```

and these imports at the top:

```go
"go.mongodb.org/mongo-driver/v2/bson"
"go.mongodb.org/mongo-driver/v2/mongo"
```

Then run `npx selfauth db migrate` as below.
:::

## Review and apply

```bash
npx selfauth db plan
```

```text
Pending migrations (1):
  • 20261119120000_add_notes  (db/migrations/20261119120000_add_notes/migration.sql)
  ✓ Nothing here loses data or touches SelfAuth's tables.
```

`plan` reads every migration that hasn't run yet and looks for statements that could lose data (dropping a table or a column, changing a type) and for changes to SelfAuth's own tables. A new table of yours does neither, so it's clear. Apply it:

```bash
npx selfauth db migrate
```

```text
Pending migrations (1):
  • 20261119120000_add_notes  (db/migrations/20261119120000_add_notes/migration.sql)
  ✓ Nothing here loses data or touches SelfAuth's tables.
Applied: [20261119120000_add_notes]
  ✓ Migrations applied.
```

## Check it worked

```bash
npx selfauth db status
```

```text
applied: [20261116085533_selfauth_init 20261119120000_add_notes]
pending: []
```

## If something went wrong

- **A syntax error from the database.** The SQL is for another database: check you used the tab for yours. Nothing was applied, so fix the file and run `migrate` again.
- **The migration doesn't show up as pending.** The file must be called exactly `migration.sql`, inside its own folder directly under `db/migrations/`.
- **You made a mistake in a migration you haven't applied yet.** Fix the file and run `plan` again. Once a migration has been applied, don't edit it. Add a new one instead (that's the next chapter but one). If you edit one by accident, SelfAuth notices and stops: `migration 20261119120000_add_notes was applied and has been edited since; add a new migration instead of changing an applied one`.

Next: [Build the notes endpoints](./notes-endpoints)
