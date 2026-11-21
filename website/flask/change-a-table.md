---
title: "7. Change a table later"
description: Add a column to your notes table with a new SQL migration, review it with selfauth db plan, understand what the review flags as destructive, and why you never edit an applied migration.
keywords: [alter table, add column, migration, selfauth db plan, destructive, backup, checksum, flask]
---

# 7. Change a table later

Say notes should be pinnable. You never edit a migration that has run. Add a **new** one, so every copy of the database (yours, your teammate's, production) arrives at the same place by the same steps.

## Add a migration

```text
db/migrations/20261120090000_pin_notes/migration.sql
```

::: code-group

```sql [SQLite]
ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
```

```sql [PostgreSQL]
ALTER TABLE notes ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false;
```

```sql [MySQL]
ALTER TABLE notes ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false;
```

:::

The `DEFAULT` gives the notes you already have a value. Then review and apply:

```bash
npx selfauth db plan
npx selfauth db migrate
```

A statement that can lose data (dropping a table or a column, changing a column's type) is flagged by `plan`, and `migrate` stops until you've read the finding and approved it. A change to one of SelfAuth's own `auth_` tables is flagged too: those tables belong to SelfAuth.

## Back up first

There is no undo. Before any migration on data you care about, take a backup (`pg_dump`, `mysqldump`, or copy the SQLite file). To reverse a change, restore the backup or add another migration that undoes it.

## Never edit an applied migration

Each applied migration is recorded with a fingerprint of its file. Change the file afterwards and the next run stops:

```text
migration 20261119120000_add_notes was applied and has been edited since; add a new migration instead of changing an applied one
```

Put the file back and write a new migration instead.

## If something went wrong

- **A MySQL migration failed halfway.** MySQL commits each statement as it goes, so the earlier ones stay. Restore the backup, fix the file and run again. SQLite and PostgreSQL undo the whole file.
- **`another migration is running`.** Two deploys started at once; wait and run again.

Next: [Test your endpoints](./tests)
