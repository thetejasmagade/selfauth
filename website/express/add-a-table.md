---
title: "6. Add a table"
description: Add your own notes table to an Express SelfAuth project with a Prisma model and a migration, review it with selfauth db plan and apply it. With the MongoDB equivalent.
keywords: [prisma model, migration, selfauth db generate, db plan, db migrate, add table, mongodb index, mongoose model]
---

# 6. Add a table

Notes need somewhere to live. In this chapter you'll create a `notes` table, using the same migration tools you used for SelfAuth's own tables in chapter 1.

The workflow is always the same four steps:

1. **Describe** the change in your schema.
2. **Generate** a migration, a file of SQL that makes the change.
3. **Review** it with `npx selfauth db plan`.
4. **Apply** it with `npx selfauth db migrate`.

::: warning SQLite: stop the server first
SQLite can't be changed while another program has the file open. Stop `npm run dev` (Ctrl+C in its terminal) before you run `db migrate`, and start it again afterwards. PostgreSQL, MySQL and MongoDB don't mind.
:::

## Describe the table

::: code-group

```prisma [PostgreSQL, MySQL, SQLite: prisma/schema.prisma]
// Add this at the end of the file.
model Note {
  id        String   @id @default(uuid())
  ownerId   String   @map("owner_id")
  text      String
  createdAt DateTime @default(now()) @map("created_at")

  @@index([ownerId])
  @@map("notes")
}
```

```ts [MongoDB: src/db/notes.ts (new file)]
import { Schema, type Connection } from "mongoose";

const noteSchema = new Schema(
  {
    ownerId: { type: String, required: true, index: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  // Indexes are created by `npx selfauth db migrate`, never when the server starts.
  { autoIndex: false, versionKey: false },
);

/** The notes collection, on the connection SelfAuth uses. */
export function noteModel(db: Connection) {
  return db.model("Note", noteSchema, "notes");
}
```

:::

Line by line, for the Prisma version:

- `model Note` is how your code will refer to it: `db.note`.
- `@@map("notes")` is the table's name in the database. Lowercase plural is the usual style, and it keeps clear of SelfAuth's tables, which all start with `auth_`.
- `ownerId` holds the id of the user who wrote the note. `@map("owner_id")` names the column in the database's style.
- `@@index([ownerId])` makes "find this user's notes" fast, even with millions of rows.

## Generate the migration

::: code-group

```bash [PostgreSQL, MySQL, SQLite]
npx selfauth db generate add_notes
```

```text [MongoDB]
MongoDB doesn't need a migration for a new collection. It appears the
first time you save a document. Skip to "Create the index" below.
```

:::

```text
  ✓ Created prisma/migrations/20261119090410_add_notes/migration.sql; review it, then run `selfauth db plan`.
```

The name, `add_notes`, is for you. Make it describe the change. Open the new file. It's plain SQL, and you should always read it:

```sql
-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "notes_owner_id_idx" ON "notes"("owner_id");
```

That's SQLite. PostgreSQL and MySQL write slightly different types, but the shape is the same. Nothing has changed in the database yet: this is only a file.

## Review and apply

```bash
npx selfauth db plan
```

```text
Pending migrations (1):
  • 20261119090410_add_notes  (prisma/migrations/20261119090410_add_notes/migration.sql)
  ✓ Nothing here loses data or touches SelfAuth's tables.
```

`plan` reads every migration that hasn't run yet and looks for statements that could lose data (dropping a table or a column, changing a type) and for changes to SelfAuth's own tables. A new table of yours does neither, so it's clear. Apply it:

```bash
npx selfauth db migrate
```

```text
  ✓ Migrations applied.
```

Finally, regenerate the Prisma client, so that your code knows about `db.note`:

```bash
npm run generate
```

Forget this step and TypeScript will tell you that `note` doesn't exist on the client.

## Create the index (MongoDB)

Open `src/scripts/migrate.ts`. At the top, import your model:

```ts
import { noteModel } from "../db/notes.ts";
```

Then find the line `await createIndexes(store, rateLimits);` and add one below it:

```ts
await noteModel(connection).createIndexes();
```

Now `npx selfauth db migrate` creates your index along with SelfAuth's. Run it.

## Check it worked

```bash
npx selfauth db status
```

Both migrations should be listed as applied, with nothing pending. Start the server again with `npm run dev`.

## If something went wrong

- **`the SQLite database is locked`.** The server is still running. Stop it and run the command again.
- **`Property 'note' does not exist`.** Run `npm run generate`.
- **`No schema changes.`** from `db generate`. The schema file wasn't saved, or the model is already in an earlier migration.
- **You made a mistake in a migration you haven't applied yet.** Delete its folder under `prisma/migrations/`, fix the schema and generate it again. Once a migration has been applied, don't edit it. Add a new one instead (that's the next chapter but one).

Next: [Build the notes endpoints](./notes-endpoints)
