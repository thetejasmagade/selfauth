---
title: "7. Build the notes endpoints"
description: Write the notes endpoints for an Express SelfAuth project, save a note, list your own notes and an admin-only list of everyone's, each guarded by a permission, and try them as a user and as an admin.
keywords: [requirePermission, express router, prisma create, findMany, ownership, admin endpoint, view_any, 403]
---

# 7. Build the notes endpoints

Everything comes together here: the permissions from chapter 5 and the table from chapter 6. You'll write three endpoints:

| Endpoint | Permission | Does |
| --- | --- | --- |
| `POST /api/notes` | `notes.create` | Saves a note for the signed-in user |
| `GET /api/notes` | `notes.view` | Lists *your own* notes |
| `GET /api/admin/notes` | `notes.view_any` | Lists *everyone's* notes, for admins |

## Write them

Create a new file for them, so `src/routes/index.ts` stays short:

::: code-group

```ts [PostgreSQL, MySQL, SQLite: src/routes/notes.ts]
import express from "express";
import type { Auth } from "../auth/index.ts";
import type { Database } from "../db/store.ts";
import { HttpError } from "../http/errors.ts";

export function mountNotes(app: express.Express, auth: Auth, db: Database): void {
  const notes = express.Router();

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
import type { Auth } from "../auth/index.ts";
import type { Database } from "../db/store.ts";
import { noteModel } from "../db/notes.ts";
import { HttpError } from "../http/errors.ts";

export function mountNotes(app: express.Express, auth: Auth, db: Database): void {
  const Note = noteModel(db);
  const notes = express.Router();

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

## Try it as Sam

Sam (`A`) saves a note of his own, then lists notes:

```bash
curl "${A[@]}" localhost:3000/api/notes -d '{"text":"Sam was here"}'
curl "${A[@]}" localhost:3000/api/notes
```

```json
{"notes":[{"id":"3a9e05f8-…","ownerId":"4b7d469a-…","text":"Sam was here",…}]}
```

Only his own note, even though he's an admin. `/api/notes` always means *my* notes. The admin list is where he sees everything:

```bash
curl "${A[@]}" localhost:3000/api/admin/notes
```

```json
{"notes":[{"text":"Sam was here",…},{"text":"Call the dentist",…},{"text":"Buy milk",…}]}
```

## Check it worked

You should have seen all of this:

- Maya can save notes and sees only her own.
- Maya gets `403` from the admin list.
- Sam sees only his own notes at `/api/notes`, and all three at `/api/admin/notes`.

Also try an empty note, `-d '{"text":"   "}'`. You should get `VALIDATION_FAILED`.

## If something went wrong

- **`NOT_FOUND` for every notes URL.** `mountNotes` isn't being called. Check the two lines in `src/routes/index.ts`, and that `DATABASE_URL` is set in `.env`: without a database, the notes are left out.
- **`FORBIDDEN` for Maya on `/api/notes`.** The permissions aren't in the database. Run `npm run db:seed` (chapter 5).
- **`Unknown permission 'notes.craete'` when the server starts.** The permission in `requirePermission(...)` is misspelled, or missing from `selfauth.config.ts`. SelfAuth stops at startup rather than letting a typo lock everyone out quietly.
- **`INTERNAL_ERROR`, and the server's terminal says the table `notes` does not exist.** The migration didn't run. Run `npx selfauth db migrate`.

Next: [Change a table later](./change-a-table)
