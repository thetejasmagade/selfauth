---
title: "6. Add a table and the notes routes"
description: Add your own notes table to a Next.js SelfAuth project with a Prisma model and a migration, review it with selfauth db plan, then write the notes route handlers, each guarded by a permission, and try them as a user and as an admin. With the MongoDB equivalent.
keywords: [prisma model, migration, selfauth db generate, db plan, db migrate, requirePermission, authorizeResource, route handler, ownership, admin route, view_any, mongoose]
---

# 6. Add a table and the notes routes

Notes need somewhere to live, and routes to save and read them. The permissions from [chapter 5](./permissions) are about to earn their keep.

## Add the table

The workflow for any database change is always the same four steps:

1. **Describe** the change in your schema.
2. **Generate** a migration, a file of SQL that makes the change.
3. **Review** it with `npx selfauth db plan`.
4. **Apply** it with `npx selfauth db migrate`.

::: warning SQLite: stop the server first
SQLite can't be changed while another program has the file open. Stop `npm run dev` (Ctrl+C in its terminal) before you run `db migrate`, and start it again afterwards. PostgreSQL, MySQL and MongoDB don't mind.
:::

### Describe the table

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

For the Prisma version: `model Note` is how your code refers to it (`db.note`); `@@map("notes")` is the table's name in the database (lowercase plural, clear of SelfAuth's `auth_` tables); `ownerId` holds the id of the user who wrote the note; and `@@index([ownerId])` makes "find this user's notes" fast, even with millions of rows.

### Generate, review and apply the migration

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
  ✓ Created prisma/migrations/20261122060132_add_notes/migration.sql; review it, then run `selfauth db plan`.
```

Open the new file. It's plain SQL, and you should always read it (this is SQLite's version; PostgreSQL and MySQL write slightly different types):

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

Nothing has changed in the database yet: this is only a file. Review and apply it:

```bash
npx selfauth db plan
```

```text
Pending migrations (1):
  • 20261122060132_add_notes  (prisma/migrations/20261122060132_add_notes/migration.sql)
  ✓ Nothing here loses data or touches SelfAuth's tables.
```

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

### Create the index (MongoDB)

Open `src/scripts/migrate.ts`. At the top, import your model:

```ts
import { noteModel } from "../db/notes.ts";
```

Then find the line `await createIndexes(store, rateLimits);` and add one below it:

```ts
await noteModel(connection).createIndexes();
```

Now `npx selfauth db migrate` creates your index along with SelfAuth's. Run it.

## The routes

You'll write four routes, using two kinds of guard:

| Route | Guard | Does |
| --- | --- | --- |
| `POST /api/notes` | `requirePermission("notes.create")` | Saves a note for the signed-in user |
| `GET /api/notes` | `requirePermission("notes.view")` | Lists *your own* notes |
| `GET /api/notes/[id]` | `authorizeResource("notes.view", …)` | Reads one note, if it's yours (or you're an admin) |
| `GET /api/admin/notes` | `requirePermission("notes.view_any")` | Lists *everyone's* notes, for admins |

`requirePermission` asks one question: *does this user have the permission?* That's enough for saving a note or listing your own. But for one note by id it isn't: Maya has `notes.view`, yet she mustn't read Sam's note just by guessing its id. `authorizeResource` asks the second question too: *is this particular note theirs?*

### Save and list: `src/app/api/notes/route.ts`

::: code-group

```ts [PostgreSQL, MySQL, SQLite]
import { HttpError } from "../../../http/errors.ts";
import { withAuth } from "../../../lib/auth.ts";

export const dynamic = "force-dynamic";

// Save a note for the signed-in user.
export const POST = withAuth((auth, db) =>
  auth.protect(auth.requirePermission("notes.create"), async (req, call) => {
    const text = (await auth.json(req))["text"];
    if (typeof text !== "string" || text.trim() === "" || text.length > 2000) {
      throw new HttpError(400, "VALIDATION_FAILED", "text is required, at most 2000 characters.");
    }
    const note = await db!.note.create({ data: { ownerId: call.auth.userId, text } });
    return Response.json({ note }, { status: 201 });
  }),
);

// The signed-in user's own notes, newest first.
export const GET = withAuth((auth, db) =>
  auth.protect(auth.requirePermission("notes.view"), async (_req, call) => {
    const notes = await db!.note.findMany({
      where: { ownerId: call.auth.userId },
      orderBy: { createdAt: "desc" },
    });
    return Response.json({ notes });
  }),
);

export const OPTIONS = withAuth((auth) => auth.preflight);
```

```ts [MongoDB]
import { HttpError } from "../../../http/errors.ts";
import { noteModel } from "../../../db/notes.ts";
import { withAuth } from "../../../lib/auth.ts";

export const dynamic = "force-dynamic";

// Save a note for the signed-in user.
export const POST = withAuth((auth, db) =>
  auth.protect(auth.requirePermission("notes.create"), async (req, call) => {
    const text = (await auth.json(req))["text"];
    if (typeof text !== "string" || text.trim() === "" || text.length > 2000) {
      throw new HttpError(400, "VALIDATION_FAILED", "text is required, at most 2000 characters.");
    }
    const note = await noteModel(db!).create({ ownerId: call.auth.userId, text });
    return Response.json({ note }, { status: 201 });
  }),
);

// The signed-in user's own notes, newest first.
export const GET = withAuth((auth, db) =>
  auth.protect(auth.requirePermission("notes.view"), async (_req, call) => {
    const notes = await noteModel(db!)
      .find({ ownerId: call.auth.userId })
      .sort({ createdAt: -1 })
      .lean();
    return Response.json({ notes });
  }),
);

export const OPTIONS = withAuth((auth) => auth.preflight);
```

:::

### One note: `src/app/api/notes/[id]/route.ts`

::: code-group

```ts [PostgreSQL, MySQL, SQLite]
import { ownershipPolicy } from "../../../../auth/index.ts";
import { withAuth } from "../../../../lib/auth.ts";

export const dynamic = "force-dynamic";

// One note: its owner, or anyone with notes.view_any.
export const GET = withAuth((auth, db) => {
  // How SelfAuth finds a note and its owner, for authorizeResource below.
  auth.policies.register(
    "note",
    ownershipPolicy(async (id) => {
      const note = await db!.note.findUnique({ where: { id } });
      return note ? { type: "note", id: note.id, ownerId: note.ownerId } : null;
    }),
  );
  const noteId = (_req: Request, call: { params: Record<string, string | string[] | undefined> }) => ({
    type: "note",
    id: String(call.params["id"]),
  });
  return auth.protect(auth.authorizeResource("notes.view", noteId), async (_req, call) => {
    const note = await db!.note.findUnique({ where: { id: String(call.params["id"]) } });
    return Response.json({ note });
  });
});

export const OPTIONS = withAuth((auth) => auth.preflight);
```

```ts [MongoDB]
import { isValidObjectId } from "mongoose";
import { ownershipPolicy } from "../../../../auth/index.ts";
import { noteModel } from "../../../../db/notes.ts";
import { withAuth } from "../../../../lib/auth.ts";

export const dynamic = "force-dynamic";

// One note: its owner, or anyone with notes.view_any.
export const GET = withAuth((auth, db) => {
  const Note = noteModel(db!);
  // How SelfAuth finds a note and its owner, for authorizeResource below.
  auth.policies.register(
    "note",
    ownershipPolicy(async (id) => {
      if (!isValidObjectId(id)) return null; // a malformed id is simply "not found"
      const note = await Note.findById(id).lean();
      return note ? { type: "note", id, ownerId: note.ownerId } : null;
    }),
  );
  const noteId = (_req: Request, call: { params: Record<string, string | string[] | undefined> }) => ({
    type: "note",
    id: String(call.params["id"]),
  });
  return auth.protect(auth.authorizeResource("notes.view", noteId), async (_req, call) => {
    const note = await Note.findById(String(call.params["id"])).lean();
    return Response.json({ note });
  });
});

export const OPTIONS = withAuth((auth) => auth.preflight);
```

:::

### Everyone's notes, for admins: `src/app/api/admin/notes/route.ts`

::: code-group

```ts [PostgreSQL, MySQL, SQLite]
import { withAuth } from "../../../../lib/auth.ts";

export const dynamic = "force-dynamic";

// Admins only: everyone's notes.
export const GET = withAuth((auth, db) =>
  auth.protect(auth.requirePermission("notes.view_any"), async () => {
    const notes = await db!.note.findMany({ orderBy: { createdAt: "desc" } });
    return Response.json({ notes });
  }),
);

export const OPTIONS = withAuth((auth) => auth.preflight);
```

```ts [MongoDB]
import { noteModel } from "../../../../db/notes.ts";
import { withAuth } from "../../../../lib/auth.ts";

export const dynamic = "force-dynamic";

// Admins only: everyone's notes.
export const GET = withAuth((auth, db) =>
  auth.protect(auth.requirePermission("notes.view_any"), async () => {
    const notes = await noteModel(db!).find().sort({ createdAt: -1 }).lean();
    return Response.json({ notes });
  }),
);

export const OPTIONS = withAuth((auth) => auth.preflight);
```

:::

The `db!` means "I know the database is there". It's `undefined` only if you run without `DATABASE_URL`, and these routes can't work without one.

## What makes this safe

- **`auth.protect(auth.requirePermission("notes.create"), …)`** checks the permission before your function runs. Someone signed in without it gets `403`. Someone not signed in at all gets `401`.
- **The owner comes from the session.** `ownerId: call.auth.userId` is the signed-in user, worked out on the server. Never take an owner id from the request body, or anyone could save notes as someone else.
- **The list is filtered in the query.** `where: { ownerId: … }` asks the database for this user's notes only. Don't load everything and filter afterwards. It's slower, and one mistake shows other people's data.
- **`authorizeResource` checks the one record.** It looks the note up with the function you registered under `"note"`, then allows the request if the user has `notes.view` *and* owns it, or has `notes.view_any`. That `_any` rule is why the admin list and the single-note route share one permission.
- **The admin route is a separate file** with its own permission. That's easier to read and to test than one route that behaves differently depending on who calls it.
- **Registering the policy twice is fine.** Next.js runs a route file again after every edit, and SelfAuth keeps the newest policy for a type, so you won't see "already registered" errors while you work.

## Try it as Maya

The server picks up the new files when you save (start it again if you stopped it for the migration). Make sure Maya is signed in (`H` from chapter 5), then save two notes:

```bash
curl "${H[@]}" localhost:3000/api/notes -d '{"text":"Buy milk"}'
curl "${H[@]}" localhost:3000/api/notes -d '{"text":"Call the dentist"}'
```

```json
{"note":{"id":"bddd5466-…","ownerId":"cd6b5786-…","text":"Buy milk","createdAt":"2026-11-22T06:02:06.752Z"}}
{"note":{"id":"35f57abf-…","ownerId":"cd6b5786-…","text":"Call the dentist","createdAt":"2026-11-22T06:02:06.771Z"}}
```

List them:

```bash
curl "${H[@]}" localhost:3000/api/notes
```

```json
{"notes":[{"id":"35f57abf-…","text":"Call the dentist",…},{"id":"bddd5466-…","text":"Buy milk",…}]}
```

Now try the admin list:

```bash
curl "${H[@]}" localhost:3000/api/admin/notes
```

```json
{"error":{"code":"FORBIDDEN","message":"You do not have permission to perform this action.","requestId":"32b41573-…"}}
```

Maya isn't an admin, so she's refused.

## Read one note

Copy the `id` of one of Maya's notes from the list above and read it:

```bash
curl "${H[@]}" localhost:3000/api/notes/35f57abf-811b-4401-95ab-4d2c56265844
```

```json
{"note":{"id":"35f57abf-…","ownerId":"cd6b5786-…","text":"Call the dentist","createdAt":"2026-11-22T06:02:06.771Z"}}
```

Now ask for an id that doesn't exist:

```bash
curl "${H[@]}" localhost:3000/api/notes/does-not-exist
```

```json
{"error":{"code":"NOT_FOUND","message":"Not found.","requestId":"017cec02-…"}}
```

You'll try someone else's note in a moment. It gives exactly the same answer.

## Try it as Sam

Sam (`A`) saves a note of his own, then lists notes:

```bash
curl "${A[@]}" localhost:3000/api/notes -d '{"text":"Sam was here"}'
curl "${A[@]}" localhost:3000/api/notes
```

```json
{"notes":[{"id":"764480ec-…","ownerId":"4c413aa8-…","text":"Sam was here",…}]}
```

Only his own note, even though he's an admin. Now swap: Maya asks for Sam's note, using the `id` from his list:

```bash
curl "${H[@]}" localhost:3000/api/notes/764480ec-65a9-4bb0-bc82-961291195d3b
```

```json
{"error":{"code":"NOT_FOUND","message":"Not found.","requestId":"a5fe0740-…"}}
```

`NOT_FOUND`, not `FORBIDDEN`. Maya can't even tell the note exists, which is what you want: a "forbidden" answer would confirm that the id is real. Sam, holding `notes.view_any`, can read Maya's note at `/api/notes/<her id>`.

Back to the lists. `/api/notes` always means *my* notes. The admin list is where he sees everything:

```bash
curl "${A[@]}" localhost:3000/api/admin/notes
```

```json
{"notes":[{"text":"Sam was here",…},{"text":"Call the dentist",…},{"text":"Buy milk",…}]}
```

## Check it worked

You should have seen all of this:

- Maya can save notes and sees only her own.
- Maya can read one of her notes by id, and gets `NOT_FOUND` for Sam's.
- Maya gets `403` from the admin list.
- Sam sees only his own notes at `/api/notes`, and all three at `/api/admin/notes`.

Also try an empty note, `-d '{"text":"   "}'`. You should get `VALIDATION_FAILED`.

## If something went wrong

- **`NOT_FOUND` for every notes URL.** The file isn't named `route.ts`, or it's in the wrong folder. The folders are the path: `src/app/api/notes/[id]/route.ts` is `/api/notes/<id>`, brackets included.
- **`INTERNAL_ERROR`, and the terminal says `Unknown permission 'notes.create'`.** The permission isn't in `selfauth.config.ts`, or you didn't restart `npm run dev` after adding it.
- **`Property 'note' does not exist`** from TypeScript. Run `npm run generate` after the migration.
- **`NOT_FOUND` for every single note, even your own.** The `"note"` in `auth.policies.register("note", …)` must match the `type: "note"` in `noteId`, exactly.
- **`Cannot read properties of undefined (reading 'note')`.** There is no database: `DATABASE_URL` isn't set in `.env`, so `db` is `undefined`.

Next: [Add a page for the notes](./frontend-page)
