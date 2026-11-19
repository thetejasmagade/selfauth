---
title: "8. Change a table later"
description: Add a column to your own table in an Express SelfAuth project, understand why selfauth db plan asks for approval, approve it, and know what to do instead of rolling back.
keywords: [add column, alter table, migration, db plan, approve-destructive, not_owned, rollback, backup]
---

# 8. Change a table later

Apps change. Say notes should have an optional title. That's a change to a table that already has data in it, and it works the same way as last time: describe, generate, review, apply. The review is the part that's different.

## Describe and generate

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

## Review it

```bash
npx selfauth db plan
```

```text
Pending migrations (1):
  • 20261119090705_add_note_title  (prisma/migrations/20261119090705_add_note_title/migration.sql)

Changes that need explicit approval:
  ⚠ [destructive] not_owned notes — 20261119090705_add_note_title:2
```

Don't panic. Here's what it means.

SelfAuth keeps a list of the tables it created (they're in `selfauth.manifest.json`, and all start with `auth_`). Any migration that changes a table *not* on that list gets flagged as `not_owned`, so that nothing can quietly alter tables SelfAuth doesn't know about. `notes` is your table, so SelfAuth flags it and leaves the decision to you.

Your job is to read the SQL and decide. Adding an optional column loses nothing, so it's safe. Compare that with a migration that drops a column, where `plan` shows a second finding:

```text
  ⚠ [destructive] not_owned notes — …
  ⚠ [destructive] drop_column notes — …
```

`drop_column` deletes data for good. Stop and think before you approve one of those.

## Apply it

Because the plan needs approval, a plain `migrate` refuses:

```bash
npx selfauth db migrate
```

```text
  ✗ plan contains destructive or non-owned changes; review the findings and approve explicitly
```

You've read it and you're sure, so approve it. On SQLite, stop the server first:

```bash
npx selfauth db migrate --approve-destructive
```

```text
  ✓ Migrations applied.
```

Then regenerate the client and start the server again:

```bash
npm run generate
npm run dev
```

::: tip MongoDB
MongoDB has no columns to migrate. Add `title: { type: String }` to the schema in `src/db/notes.ts` and you're done. Old documents simply don't have the field.
:::

## Use the new column

In `src/routes/notes.ts`, accept an optional title when saving. Replace the `db.note.create(...)` call with:

```ts
const title = req.body?.title;
if (title !== undefined && (typeof title !== "string" || title.length > 100)) {
  throw new HttpError(400, "VALIDATION_FAILED", "title must be text, at most 100 characters.");
}
const note = await db.note.create({
  data: { ownerId: auth.context(res)!.userId, title, text },
});
```

## Check it worked

```bash
curl "${H[@]}" localhost:3000/api/notes -d '{"title":"Shopping","text":"Eggs and bread"}'
```

```json
{"note":{"id":"7ea3d04e-…","ownerId":"e930577e-…","title":"Shopping","text":"Eggs and bread","createdAt":"2026-11-19T09:07:28.296Z"}}
```

Your older notes come back with `"title":null`.

## Undoing a change

There's no automatic rollback, on purpose: "undoing" a migration that dropped a column can't bring the data back. Instead:

- **Before you apply,** delete the migration's folder and fix the schema.
- **After you apply,** write a new migration that reverses the change. To remove the title again, delete the line from the schema and run `db generate remove_note_title`.
- **If data was lost,** restore from a backup. In production, take one before every migration.

`npx selfauth db rollback` prints this same advice.

## Rules of thumb

- New columns should be optional, or have a default (`@default(...)`).
- Never edit a migration that has already been applied anywhere. Add a new one.
- Commit the `prisma/migrations/` folder. It's how your teammates and your production server get the same tables.
- Read every `plan` before you approve it.

Next: [Add a frontend page](./frontend-page)
