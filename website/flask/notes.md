---
title: "6. Add a table and build the notes endpoints"
description: Add your own notes table to a Flask SelfAuth project with a plain SQL migration, review it with selfauth db plan, then write the endpoints with require_permission and authorize_resource so each user sees only their own notes and admins see everyone's.
keywords: [flask migration, selfauth db plan, db migrate, notes table, authorize_resource, ownership_policy, require_permission, view_any, sqlite, mongodb]
---

# 6. Add a table and build the notes endpoints

## Write the migration

A Flask project keeps its migrations as plain SQL files. Each is a folder holding one `migration.sql`, and they run in the order of their folder names, so start with the date and time:

```text
db/migrations/20261119120000_add_notes/migration.sql
```

::: code-group

```sql [SQLite]
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX notes_owner_id_idx ON notes (owner_id);
```

```sql [PostgreSQL]
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL
);

CREATE INDEX notes_owner_id_idx ON notes (owner_id);
```

```sql [MySQL]
CREATE TABLE notes (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  owner_id CHAR(36) NOT NULL,
  text TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL
);

CREATE INDEX notes_owner_id_idx ON notes (owner_id);
```

:::

SQLite stores times as milliseconds since 1970 (an integer), the other two have real date types. You won't need to care in Python: the code below asks the database layer to convert.

Review, apply and check:

```bash
npx selfauth db plan
npx selfauth db migrate
npx selfauth db status
```

```text
Pending migrations (1):
  • 20261119120000_add_notes  (db/migrations/20261119120000_add_notes/migration.sql)
  ✓ Nothing here loses data or touches SelfAuth's tables.
Applied: [20261119120000_add_notes]
applied: [20261116085533_selfauth_init 20261119120000_add_notes]
pending: []
```

::: details MongoDB
A collection appears the first time you save a document, so there is no migration. Add the index you need once, in `app/cmd/migrate.py`, after the call to `store.migrate(...)`:

```python
        if database == "mongodb":
            from ..store import mongostore

            db = mongostore.open_database(url)
            db["notes"].create_index("ownerId")
            db.client.close()
```
:::

## Write the endpoints

| Endpoint | Guard | Does |
| --- | --- | --- |
| `POST /api/notes` | `require_permission("notes.create")` | Saves a note for the signed-in user |
| `GET /api/notes` | `require_permission("notes.view")` | Lists *your own* notes |
| `GET /api/notes/<id>` | `authorize_resource("notes.view", …)` | Reads one note, if it's yours (or you're an admin) |
| `GET /api/admin/notes` | `require_permission("notes.view_any")` | Lists *everyone's* notes |

`require_permission` asks *does this user have the permission?* That's enough for saving a note or listing your own. For one note it isn't: Maya has `notes.view`, but she mustn't read Sam's note by guessing its id. `authorize_resource` also asks *is this particular note theirs?*, using a policy that tells SelfAuth how to find a note and its owner.

Create `app/notes.py`. `db.sql` is the connection SelfAuth uses, and the SQL below runs unchanged on SQLite, MySQL and PostgreSQL (`?` is the placeholder everywhere):

```python
"""The notes endpoints: save a note, list your own, read one if it is yours, and an admin list."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from flask import Flask, jsonify

from . import httpx
from .auth import errors
from .auth.authz import Resource, ownership_policy
from .auth.clock import iso
from .flask_auth import Auth
from .store import DB


def register_notes(app: Flask, auth: Auth, db: DB) -> None:
    sql = db.sql  # the same connection SelfAuth uses
    when = sql.dialect  # turns a datetime into what this database stores, and back

    def to_json(row) -> dict:
        return {
            "id": str(row[0]), "ownerId": str(row[1]), "text": row[2],
            "createdAt": iso(when.read_time(row[3])),
        }

    def load(note_id: str) -> Resource | None:
        # How SelfAuth finds a note and its owner, for authorize_resource below.
        row = sql.query_one("SELECT owner_id FROM notes WHERE id = ?", [note_id])
        return None if row is None else Resource("note", note_id, str(row[0]))

    auth.policies.register("note", ownership_policy(load))
    api = auth.protected(app, "/api")

    @api.post("/notes", auth.require_permission("notes.create"))
    def create_note():
        text = httpx.body().get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 2000:
            raise errors.AuthError(errors.VALIDATION_FAILED, "text is required, at most 2000 characters.")
        note_id = secrets.token_hex(16)
        sql.execute(
            "INSERT INTO notes (id, owner_id, text, created_at) VALUES (?, ?, ?, ?)",
            [note_id, auth.context().subject.user_id, text, when.t(datetime.now(timezone.utc))],
        )
        row = sql.query_one("SELECT id, owner_id, text, created_at FROM notes WHERE id = ?", [note_id])
        response = jsonify({"note": to_json(row)})
        response.status_code = 201
        return response

    @api.get("/notes", auth.require_permission("notes.view"))
    def my_notes():
        rows = sql.query(
            "SELECT id, owner_id, text, created_at FROM notes WHERE owner_id = ? ORDER BY created_at DESC",
            [auth.context().subject.user_id],
        )
        return jsonify({"notes": [to_json(r) for r in rows]})

    @api.get("/notes/<note_id>", auth.authorize_resource("notes.view", "note", "note_id"))
    def one_note(note_id: str):
        row = sql.query_one("SELECT id, owner_id, text, created_at FROM notes WHERE id = ?", [note_id])
        return jsonify({"note": to_json(row)})

    @api.get("/admin/notes", auth.require_permission("notes.view_any"))
    def all_notes():
        rows = sql.query("SELECT id, owner_id, text, created_at FROM notes ORDER BY created_at DESC")
        return jsonify({"notes": [to_json(r) for r in rows]})
```

Always pass values as the list after the SQL, never build the SQL with f-strings: that is what keeps a note's text from becoming a command.

Register it in `app/routes.py`:

```python
from .notes import register_notes
```

and at the end of `register`:

```python
    if db.sql is not None:
        register_notes(app, auth, db)
```

::: details MongoDB version
With MongoDB `db.mongo` is a PyMongo database. The policy and the guards are identical; only the queries change:

```python
    notes = db.mongo["notes"]

    def load(note_id):
        doc = notes.find_one({"_id": note_id}, {"ownerId": 1})
        return None if doc is None else Resource("note", note_id, doc["ownerId"])

    # create:  notes.insert_one({"_id": note_id, "ownerId": user_id, "text": text, "createdAt": now})
    # mine:    notes.find({"ownerId": user_id}).sort("createdAt", -1)
    # one:     notes.find_one({"_id": note_id})
    # admin:   notes.find().sort("createdAt", -1)
```

Return documents with `id`, `ownerId`, `text` and `createdAt` fields like the SQL version does.
:::

## Try it as a user and as an admin

Restart the server, sign Maya and Sam in (their cookies in `maya` and `sam`, as in chapter 2) and:

```bash
curl -s -b maya -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' localhost:3000/api/notes -d '{"text":"Buy milk"}'
curl -s -b sam localhost:3000/api/notes
curl -s -b sam localhost:3000/api/notes/MAYAS-NOTE-ID
curl -s -b sam localhost:3000/api/admin/notes
```

```text
{"note":{"id":"d5033e…","ownerId":"fba22e…","text":"Buy milk","createdAt":"2026-11-21T05:53:16.408Z"}}
{"notes":[]}
{"error":{"code":"NOT_FOUND","message":"Not found.","requestId":"…"}}
{"error":{"code":"FORBIDDEN","message":"You do not have permission to perform this action.","requestId":"…"}}
```

Sam sees no notes and gets `404`, not `403`, for Maya's note: a `403` would tell him it exists. After `python -m app.cmd.create_admin maya@example.com`, Maya's call to `/api/admin/notes` returns everyone's notes.

## If something went wrong

- **`no such table: notes`.** Run `npx selfauth db migrate`.
- **`unknown permission`.** Finish chapter 5: the three permissions must be in `selfauth.config.json`.
- **`database` is `in-memory` in `/api/hello`.** The server runs without `DATABASE_URL`; the notes routes are only registered when a SQL database is connected.

Next: [Change a table later](./change-a-table)
