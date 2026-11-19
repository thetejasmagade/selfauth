---
title: "8. Change a table later"
description: Add a column to your own table in a Gin (Go) SelfAuth project with a new SQL migration, see which changes selfauth db plan lets through and which it stops, remove a column with approval, and know what to do instead of rolling back.
keywords: [add column, drop column, alter table, sql migration, db plan, approve-destructive, selfauth_table, rollback, backup, gin]
---

# 8. Change a table later

Apps change. Say notes should have an optional title. The table already has data in it, so you don't edit the migration you wrote in chapter 6. You add a new one. What's new here is learning what `db plan` lets through and what it stops you on.

## Add a column

Create `db/migrations/20261119130000_add_note_title/migration.sql`:

```sql
ALTER TABLE notes ADD COLUMN title TEXT;
```

The same line works on SQLite, PostgreSQL and MySQL. The column allows empty values, which matters: your existing notes have no title, so a required column would have nothing to put in them.

Apply it:

```bash
npx selfauth db migrate
```

```text
Pending migrations (1):
  • 20261119130000_add_note_title  (db/migrations/20261119130000_add_note_title/migration.sql)
  ✓ Nothing here loses data or touches SelfAuth's tables.
Applied: [20261119130000_add_note_title]
  ✓ Migrations applied.
```

No approval needed. The table is yours and the change deletes nothing, so `plan` has nothing to warn you about.

::: tip MongoDB
MongoDB has no columns to migrate. Add the field to the `note` struct (below) and you're done. Old documents simply don't have it.
:::

### Use the new column

Four small changes in `internal/routes/notes.go`. Add the field to the struct. It's a pointer, so a note without a title comes out as `null`:

```go
type note struct {
	ID        string    `json:"id"`
	OwnerID   string    `json:"ownerId"`
	Title     *string   `json:"title"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"createdAt"`
}
```

When saving, read an optional title and store it. Replace the `db.ExecContext(...)` call with:

```go
if title, ok := httpx.Body(c)["title"].(string); ok {
	if len(title) > 100 {
		httpx.WriteError(c, http.StatusBadRequest, auth.ValidationFailed, "title must be text, at most 100 characters.", nil)
		return
	}
	n.Title = &title
}
_, err := db.ExecContext(c, `INSERT INTO notes (id, owner_id, title, text, created_at) VALUES (?, ?, ?, ?, ?)`,
	n.ID, n.OwnerID, n.Title, n.Text, n.CreatedAt)
```

In `queryNotes`, select and scan it:

```go
rows, err := db.QueryContext(ctx, `SELECT id, owner_id, title, text, created_at FROM notes `+rest, args...)
```

```go
if err := rows.Scan(&n.ID, &n.OwnerID, &n.Title, &n.Text, &n.CreatedAt); err != nil {
```

Restart the server and try it:

```bash
curl "${H[@]}" localhost:3000/api/notes -d '{"title":"Shopping","text":"Eggs and bread"}'
```

```json
{"note":{"id":"BLHTI3T7M2DNKMSSBP3BVZEA6P","ownerId":"6e811164-…","title":"Shopping","text":"Eggs and bread","createdAt":"2026-11-19T10:14:42.480939051Z"}}
```

Your older notes come back with `"title":null`.

## What `db plan` stops

`db plan` reads the SQL of every migration that hasn't run yet. It lets your own additions through, and stops you for two kinds of change.

| The migration… | Result |
| --- | --- |
| Creates a table, adds a column, adds an index on **your** tables | Goes straight through |
| **Deletes or rewrites data**: drops a table or column, changes a column's type, renames something, deletes rows | Needs your approval |
| Changes one of **SelfAuth's** tables, the ones starting with `auth_` | Needs your approval |

The first row is why adding the title was painless. Here's the second row.

### Remove a column

You decide that titles weren't a good idea. Take the title back out of `notes.go` (the four changes above), then write a migration, `db/migrations/20261119140000_remove_note_title/migration.sql`:

```sql
ALTER TABLE notes DROP COLUMN title;
```

See what SelfAuth thinks:

```bash
npx selfauth db plan
```

```text
Pending migrations (1):
  • 20261119140000_remove_note_title  (db/migrations/20261119140000_remove_note_title/migration.sql)

Changes that need explicit approval:
  ⚠ [destructive] drop_column notes — 20261119140000_remove_note_title:1
      deletes a column and the data in it
```

Each finding comes with a sentence saying what it means. This time `plan` stops you, and for a good reason: every title will be gone. A plain `migrate` refuses:

```bash
npx selfauth db migrate
```

```text
  ✗ plan contains destructive or non-owned changes; review the findings and approve explicitly
```

You've read the SQL, you know the title data goes, and you're happy with that. Approve it:

```bash
npx selfauth db migrate --approve-destructive
```

```text
Applied: [20261119140000_remove_note_title]
  ✓ Migrations applied.
```

::: warning Don't make a habit of the flag
`--approve-destructive` means "I've read this". Use it only after reading the findings, and never by default. Because `plan` stays quiet about harmless changes, a warning means something, so keep it that way.
:::

### Change a SelfAuth table

Suppose you want users to have a nickname, and you write `ALTER TABLE auth_users ADD COLUMN nickname TEXT;`. The plan says:

```text
Changes that need explicit approval:
  ⚠ [destructive] selfauth_table auth_users — 20261119150000_user_nickname:1
      changes a table SelfAuth owns (auth_…); that can break `selfauth upgrade`
```

SelfAuth's tables come from its own migrations, and `selfauth upgrade` expects to find them as it left them. Edit one and a later upgrade can fail or clash with your change. So the plan stops you and asks you to think.

There's an easier way. Leave `auth_users` alone and make a table of your own that points at the user:

```sql
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY,
  nickname TEXT
);
```

It's your table, so the migration goes straight through. Do this for anything extra you want to remember about a user. On MySQL, write `user_id CHAR(36)` instead of `TEXT`.

## Undoing a change

There's no automatic rollback, on purpose: "undoing" a migration that dropped a column can't bring the data back. Instead:

- **Before you apply,** delete the migration's folder, or fix it.
- **After you apply,** write a new migration that reverses the change, such as `ALTER TABLE notes ADD COLUMN title TEXT;` again.
- **If data was lost,** restore from a backup. In production, take one before every migration.

`npx selfauth db rollback` prints this same advice.

## Rules of thumb

- New columns should allow empty values, or have a `DEFAULT`.
- Never edit a migration that has already been applied anywhere. Add a new one. SelfAuth stops you if you try.
- Commit the `db/migrations/` folder. It's how your teammates and your production server get the same tables.
- Read every `plan`. When it's quiet you're fine. When it isn't, find out why before you approve.

Next: [Add a frontend page](./frontend-page)
