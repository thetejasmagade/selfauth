---
title: "8. Change a table later"
description: Add a column to your own table in a Fastify SelfAuth project, see which changes selfauth db plan lets through and which it stops, remove a column with approval, and know what to do instead of rolling back.
keywords: [add column, drop column, alter table, migration, db plan, approve-destructive, selfauth_table, rollback, backup]
---

# 8. Change a table later

Apps change. Say notes should have an optional title. The table already has data in it, and the steps are the same as last time: describe, generate, review, apply. What's new here is learning what `db plan` lets through and what it stops you on.

## Add a column

Add one line to the `Note` model in `prisma/schema.prisma`:

```prisma
model Note {
  id        String   @id @default(uuid())
  ownerId   String   @map("owner_id")
  title     String?
  text      String
  createdAt DateTime @default(now()) @map("created_at")

  @@index([ownerId])
  @@map("notes")
}
```

The `?` makes it optional. That matters: your existing notes have no title, so a required column would have nothing to put in them.

```bash
npx selfauth db generate add_note_title
```

The migration is one line:

```sql
-- AlterTable
ALTER TABLE "notes" ADD COLUMN "title" TEXT;
```

Apply it. On SQLite, stop the server first:

```bash
npx selfauth db migrate
```

```text
Pending migrations (1):
  • 20261119100016_add_note_title  (prisma/migrations/20261119100016_add_note_title/migration.sql)
  ✓ Nothing here loses data or touches SelfAuth's tables.
  ✓ Migrations applied.
```

No approval needed. The table is yours and the change deletes nothing, so `plan` has nothing to warn you about. Regenerate the client:

```bash
npm run generate
```

### Use the new column

In `src/routes/notes.ts`, accept an optional title when saving. Replace the `db.note.create(...)` call with:

```ts
const title = (req.body as { title?: unknown } | undefined)?.title;
if (title !== undefined && (typeof title !== "string" || title.length > 100)) {
  throw new HttpError(400, "VALIDATION_FAILED", "title must be text, at most 100 characters.");
}
const note = await db.note.create({
  data: { ownerId: auth.context(req)!.userId, title: title ?? null, text },
});
```

`title ?? null` turns "not sent" into an empty title. The project's TypeScript settings are strict about the difference between a missing value and an empty one, and Prisma wants `null` for "no title".

Start the server and try it:

```bash
curl "${H[@]}" localhost:3000/api/notes -d '{"title":"Shopping","text":"Eggs and bread"}'
```

```json
{"note":{"id":"7ea3d04e-…","ownerId":"e930577e-…","title":"Shopping","text":"Eggs and bread","createdAt":"2026-11-19T09:07:28.296Z"}}
```

Your older notes come back with `"title":null`.

::: tip MongoDB
MongoDB has no columns to migrate. Add `title: { type: String }` to the schema in `src/db/notes.ts` and you're done. Old documents simply don't have the field.
:::

## What `db plan` stops

`db plan` reads the SQL of every migration that hasn't run yet. It lets your own additions through, and stops you for two kinds of change.

| The migration… | Result |
| --- | --- |
| Creates a table, adds a column, adds an index on **your** tables | Goes straight through |
| **Deletes or rewrites data**: drops a table or column, changes a column's type, renames something, deletes rows | Needs your approval |
| Changes one of **SelfAuth's** tables, the ones starting with `auth_` | Needs your approval |

The first row is why adding the title was painless. Here's the second row.

### Remove a column

You decide that titles weren't a good idea. Delete the `title` line from the model and generate a migration:

```bash
npx selfauth db generate remove_note_title
```

Open the file before you do anything else. At the top, Prisma has written you a warning:

```sql
/*
  Warnings:

  - You are about to drop the column `title` on the `notes` table. All the data in the column will be lost.

*/
```

Then see what SelfAuth thinks:

```bash
npx selfauth db plan
```

```text
Pending migrations (1):
  • 20261119100020_remove_note_title  (prisma/migrations/20261119100020_remove_note_title/migration.sql)

Changes that need explicit approval:
  ⚠ [destructive] drop_table notes — 20261119100020_remove_note_title:17
      deletes a table and its rows (SQLite does this to rebuild a table when a column is dropped: check the SQL copies the data first)
  ⚠ [destructive] rename new_notes — 20261119100020_remove_note_title:18
      renames something; code and data that use the old name break
```

Each finding comes with a sentence saying what it means. This time `plan` stops you, and for a good reason: the column's data really will be lost.

The two findings look more alarming than they are, because of how SQLite works. It can't drop a column directly, so Prisma builds a new `notes` table without the column, copies the rows across, drops the old table and renames the new one. That's what the `drop_table` and `rename` are. On PostgreSQL and MySQL you'd see one finding, `drop_column notes`.

A plain `migrate` refuses:

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
  ✓ Migrations applied.
```

Then run `npm run generate` again and take the `title` handling back out of `src/routes/notes.ts`.

::: warning Don't make a habit of the flag
`--approve-destructive` means "I've read this". Use it only after reading the findings, and never by default. Because `plan` stays quiet about harmless changes, a warning means something, so keep it that way.
:::

### Change a SelfAuth table

Suppose you want users to have a nickname, and you add `nickname String?` to SelfAuth's `AuthUser` model. The plan says:

```text
Changes that need explicit approval:
  ⚠ [destructive] selfauth_table auth_users — 20261119095926_user_nickname:2
      changes a table SelfAuth owns (auth_…); that can break `selfauth upgrade`
```

SelfAuth's tables come from its own migrations, and `selfauth upgrade` expects to find them as it left them. Edit one and a later upgrade can fail or overwrite your change. So the plan stops you and asks you to think.

There's an easier way. Leave `auth_users` alone and make a table of your own that points at the user:

```prisma
model Profile {
  userId   String  @id @map("user_id")
  nickname String?

  @@map("profiles")
}
```

It's your table, so the migration goes straight through. Do this for anything extra you want to remember about a user.

## Undoing a change

There's no automatic rollback, on purpose: "undoing" a migration that dropped a column can't bring the data back. Instead:

- **Before you apply,** delete the migration's folder and fix the schema.
- **After you apply,** write a new migration that reverses the change. To bring the title back, add the line to the schema again and run `db generate add_note_title_again`.
- **If data was lost,** restore from a backup. In production, take one before every migration.

`npx selfauth db rollback` prints this same advice.

## Rules of thumb

- New columns should be optional, or have a default (`@default(...)`).
- Never edit a migration that has already been applied anywhere. Add a new one.
- Commit the `prisma/migrations/` folder. It's how your teammates and your production server get the same tables.
- Read every `plan`. When it's quiet you're fine. When it isn't, find out why before you approve.

Next: [Add a frontend page](./frontend-page)
