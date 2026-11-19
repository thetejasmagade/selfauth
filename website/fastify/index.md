---
title: Fastify guide
description: Build the SelfAuth notes app on Fastify. How a Fastify project differs from Express, and where to start.
keywords: [fastify, selfauth fastify, preHandler, fastify authentication]
---

# Fastify guide

The step-by-step Fastify guide is being written next, chapter for chapter like the [Express guide](/express/). Until it's ready, follow the Express guide with a Fastify project. Nearly everything is the same. This page lists the differences.

## Create the project

```bash
npx selfauth@latest init notes-app --backend fastify --database sqlite --frontend none
```

Then install, migrate and seed exactly as in [chapter 1](/express/create-project), and start it with `npm run dev`.

## What's the same

- The configuration file, `src/config/selfauth.config.ts`, and everything in [chapter 5](/express/permissions).
- The database: `prisma/schema.prisma`, `npx selfauth db generate`, `plan` and `migrate`, as in chapters [6](/express/add-a-table) and [8](/express/change-a-table).
- The HTTP API, the curl commands, the frontend pages and the production checklist.

## What's different: routes

Your routes are in `src/routes/index.ts`, in `mountRoutes(app, auth, db)`, as in Express. Fastify writes guards as a `preHandler`, and `auth.context` takes the request instead of the response:

```ts
app.get("/api/hello", { preHandler: auth.requireAuth }, async (req) => {
  return { hello: auth.context(req)!.user.email };
});
```

The notes endpoints from [chapter 7](/express/notes-endpoints) become the code below. Put it at the end of `mountRoutes`, and import `HttpError` from `../http/errors.ts` at the top:

```ts
// The notes need a database. Without one (the in-memory store) they are left out.
if (!db) return;

app.post("/api/notes", { preHandler: auth.requirePermission("notes.create") }, async (req, reply) => {
  const text = (req.body as { text?: unknown } | undefined)?.text;
  if (typeof text !== "string" || text.trim() === "" || text.length > 2000) {
    throw new HttpError(400, "VALIDATION_FAILED", "text is required, at most 2000 characters.");
  }
  const note = await db.note.create({ data: { ownerId: auth.context(req)!.userId, text } });
  return reply.status(201).send({ note });
});

app.get("/api/notes", { preHandler: auth.requirePermission("notes.view") }, async (req) => {
  const notes = await db.note.findMany({
    where: { ownerId: auth.context(req)!.userId },
    orderBy: { createdAt: "desc" },
  });
  return { notes };
});

app.get("/api/admin/notes", { preHandler: auth.requirePermission("notes.view_any") }, async () => {
  return { notes: await db.note.findMany({ orderBy: { createdAt: "desc" } }) };
});
```

The [server API reference](/reference/server-typescript) lists every Fastify guard.
