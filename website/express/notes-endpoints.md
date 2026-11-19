---
title: "7. Build the notes endpoints"
description: Write the notes endpoints for an Express SelfAuth project, save a note, list your own notes and an admin-only list of everyone's, each guarded by a permission, and try them as a user and as an admin.
keywords: [requirePermission, express router, prisma create, findMany, ownership, admin endpoint, view_any, 403]
---

# 7. Build the notes endpoints

Everything comes together here: the permissions from chapter 5 and the table from chapter 6. You'll write four endpoints, using two kinds of guard:

| Endpoint | Guard | Does |
| --- | --- | --- |
| `POST /api/notes` | `requirePermission("notes.create")` | Saves a note for the signed-in user |
| `GET /api/notes` | `requirePermission("notes.view")` | Lists *your own* notes |
| `GET /api/notes/:id` | `authorizeResource("notes.view", …)` | Reads one note, if it's yours (or you're an admin) |
| `GET /api/admin/notes` | `requirePermission("notes.view_any")` | Lists *everyone's* notes, for admins |

`requirePermission` asks one question: *does this user have the permission?* That's enough for saving a note or listing your own. But for `GET /api/notes/:id` it isn't: Maya has `notes.view`, yet she mustn't read Sam's note just by guessing its id. `authorizeResource` asks the second question too: *is this particular note theirs?*

## Write them

Create a new file for them, so `src/routes/index.ts` stays short:

::: code-group

```ts [PostgreSQL, MySQL, SQLite: src/routes/notes.ts]
import express from "express";
import { ownershipPolicy, type Auth } from "../auth/index.ts";
import type { Database } from "../db/store.ts";
import { HttpError } from "../http/errors.ts";

export function mountNotes(app: express.Express, auth: Auth, db: Database): void {
  const notes = express.Router();

  // How SelfAuth finds a note and its owner, for authorizeResource below.
  auth.policies.register(
    "note",
    ownershipPolicy(async (id) => {
      const note = await db.note.findUnique({ where: { id } });
      return note ? { type: "note", id: note.id, ownerId: note.ownerId } : null;
    }),
  );

  // Save a note for the signed-in user.
  notes.post("/", auth.requirePermission("notes.create"), async (req, res) => {
    const text = req.body?.text;
    if (typeof text !== "string" || text.trim() === "" || text.length > 2000) {
      throw new HttpError(400, "VALIDATION_FAILED", "text is required, at most 2000 characters.");
    }
    const note = await db.note.create({
      data: { ownerId: auth.context(res)!.userId, text },
    });
    res.status(201).json({ note });
  });

  // The signed-in user's own notes, newest first.
  notes.get("/", auth.requirePermission("notes.view"), async (_req, res) => {
    const list = await db.note.findMany({
      where: { ownerId: auth.context(res)!.userId },
      orderBy: { createdAt: "desc" },
    });
    res.json({ notes: list });
  });

  // One note: its owner, or anyone with notes.view_any.
  notes.get(
    "/:id",
    auth.authorizeResource("notes.view", (req) => ({ type: "note", id: req.params["id"] as string })),
    async (req, res) => {
      const note = await db.note.findUnique({ where: { id: req.params["id"] as string } });
      res.json({ note });
    },
  );

  app.use("/api/notes", notes);

  // Admins only: everyone's notes.
  app.get("/api/admin/notes", auth.requirePermission("notes.view_any"), async (_req, res) => {
    const list = await db.note.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ notes: list });
  });
}
```

```ts [MongoDB: src/routes/notes.ts]
import express from "express";
import { isValidObjectId } from "mongoose";
import { ownershipPolicy, type Auth } from "../auth/index.ts";
import type { Database } from "../db/store.ts";
import { noteModel } from "../db/notes.ts";
import { HttpError } from "../http/errors.ts";

export function mountNotes(app: express.Express, auth: Auth, db: Database): void {
  const Note = noteModel(db);
  const notes = express.Router();

  // How SelfAuth finds a note and its owner, for authorizeResource below.
  auth.policies.register(
    "note",
    ownershipPolicy(async (id) => {
      if (!isValidObjectId(id)) return null; // a malformed id is simply "not found"
      const note = await Note.findById(id).lean();
      return note ? { type: "note", id, ownerId: note.ownerId } : null;
    }),
  );

  // Save a note for the signed-in user.
  notes.post("/", auth.requirePermission("notes.create"), async (req, res) => {
    const text = req.body?.text;
    if (typeof text !== "string" || text.trim() === "" || text.length > 2000) {
      throw new HttpError(400, "VALIDATION_FAILED", "text is required, at most 2000 characters.");
    }
    const note = await Note.create({ ownerId: auth.context(res)!.userId, text });
    res.status(201).json({ note });
  });

  // The signed-in user's own notes, newest first.
  notes.get("/", auth.requirePermission("notes.view"), async (_req, res) => {
    const list = await Note.find({ ownerId: auth.context(res)!.userId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ notes: list });
  });

  // One note: its owner, or anyone with notes.view_any.
  notes.get(
    "/:id",
    auth.authorizeResource("notes.view", (req) => ({ type: "note", id: req.params["id"] as string })),
    async (req, res) => {
      const note = await Note.findById(req.params["id"]).lean();
      res.json({ note });
    },
  );

  app.use("/api/notes", notes);

  // Admins only: everyone's notes.
  app.get("/api/admin/notes", auth.requirePermission("notes.view_any"), async (_req, res) => {
    const list = await Note.find().sort({ createdAt: -1 }).lean();
    res.json({ notes: list });
  });
}
```

:::

Then connect them in `src/routes/index.ts`. Import the function at the top:

```ts
import { mountNotes } from "./notes.ts";
```

And call it at the end of `mountRoutes`, after `app.use("/api", api);`:

```ts
// The notes need a database. Without one (the in-memory store) they are left out.
if (db) mountNotes(app, auth, db);
```

## What makes this safe

- **`auth.requirePermission("notes.create")`** checks the permission before your function runs. Someone signed in without it gets `403`. Someone not signed in at all gets `401`.
- **The owner comes from the session.** `ownerId: auth.context(res)!.userId` is the signed-in user, worked out on the server. Never take an owner id from the request body, or anyone could save notes as someone else.
- **The list is filtered in the query.** `where: { ownerId: … }` asks the database for this user's notes only. Don't load everything and filter afterwards. It's slower, and one mistake shows other people's data.
- **`authorizeResource` checks the one record.** It looks the note up with the function you registered under `"note"`, then allows the request if the user has `notes.view` *and* owns it, or has `notes.view_any`. That `_any` rule is why the admin list and the single-note endpoint share one permission.
- **The admin endpoint is a separate route** with its own permission. That's easier to read and to test than one endpoint that behaves differently depending on who calls it.

## Try it as Maya

The server restarts when you save. Make sure Maya is signed in (`H` from chapter 5), then save two notes:

```bash
curl "${H[@]}" localhost:3000/api/notes -d '{"text":"Buy milk"}'
curl "${H[@]}" localhost:3000/api/notes -d '{"text":"Call the dentist"}'
```

```json
{"note":{"id":"0b9c3fc1-…","ownerId":"e930577e-…","text":"Buy milk","createdAt":"2026-11-19T09:06:38.209Z"}}
{"note":{"id":"402e7984-…","ownerId":"e930577e-…","text":"Call the dentist","createdAt":"2026-11-19T09:06:38.225Z"}}
```

List them:

```bash
curl "${H[@]}" localhost:3000/api/notes
```

```json
{"notes":[{"id":"402e7984-…","text":"Call the dentist",…},{"id":"0b9c3fc1-…","text":"Buy milk",…}]}
```

Now try the admin list:

```bash
curl "${H[@]}" localhost:3000/api/admin/notes
```

```json
{"error":{"code":"FORBIDDEN","message":"You do not have permission to perform this action.","requestId":"c5e3fb76-…"}}
```

Maya isn't an admin, so she's refused.

## Read one note

Copy the `id` of one of Maya's notes from the list above and read it:

```bash
curl "${H[@]}" localhost:3000/api/notes/0b9c3fc1-1605-4538-afbc-d2af200bcc5f
```

```json
{"note":{"id":"0b9c3fc1-…","ownerId":"e930577e-…","text":"Buy milk","createdAt":"2026-11-19T09:06:38.209Z"}}
```

Now ask for an id that doesn't exist:

```bash
curl "${H[@]}" localhost:3000/api/notes/does-not-exist
```

```json
{"error":{"code":"NOT_FOUND","message":"Not found.","requestId":"defe3ce7-…"}}
```

You'll try someone else's note in a moment. It gives exactly the same answer.

## Try it as Sam

Sam (`A`) saves a note of his own, then lists notes:

```bash
curl "${A[@]}" localhost:3000/api/notes -d '{"text":"Sam was here"}'
curl "${A[@]}" localhost:3000/api/notes
```

```json
{"notes":[{"id":"3a9e05f8-…","ownerId":"4b7d469a-…","text":"Sam was here",…}]}
```

Only his own note, even though he's an admin. Now swap: Maya asks for Sam's note, using the `id` from his list:

```bash
curl "${H[@]}" localhost:3000/api/notes/3a9e05f8-460b-4d83-a906-170f557f1957
```

```json
{"error":{"code":"NOT_FOUND","message":"Not found.","requestId":"cd5b4a18-…"}}
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

- **`NOT_FOUND` for every notes URL.** `mountNotes` isn't being called. Check the two lines in `src/routes/index.ts`, and that `DATABASE_URL` is set in `.env`: without a database, the notes are left out.
- **`NOT_FOUND` for every single note, even your own.** The `"note"` in `auth.policies.register("note", …)` must match the `type: "note"` in `authorizeResource`, exactly.
- **`policy for 'note' already registered`.** `mountNotes` is called twice. Call it once, in `mountRoutes`.
- **`FORBIDDEN` for Maya on `/api/notes`.** The permissions aren't in the database. Run `npm run db:seed` (chapter 5).
- **`Unknown permission 'notes.craete'` when the server starts.** The permission in `requirePermission(...)` is misspelled, or missing from `selfauth.config.ts`. SelfAuth stops at startup rather than letting a typo lock everyone out quietly.
- **`INTERNAL_ERROR`, and the server's terminal says the table `notes` does not exist.** The migration didn't run. Run `npx selfauth db migrate`.

Next: [Change a table later](./change-a-table)
