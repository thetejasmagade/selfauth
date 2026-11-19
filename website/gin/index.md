---
title: Gin (Go) guide
description: Build the SelfAuth notes app on Gin, in Go. How a Gin project differs from Express, the commands it uses, and where your routes and migrations go.
keywords: [gin, go, golang, selfauth gin, gin authentication, go migrations]
---

# Gin (Go) guide

The step-by-step Gin guide is being written next, chapter for chapter like the [Express guide](/express/). Until it's ready, the Express guide explains every idea. This page gives you the Go side of each step.

## Create and run

```bash
npx selfauth@latest init notes-app --backend gin --database sqlite --frontend none
cd notes-app
```

The Go server reads its settings from the environment. It doesn't load a `.env` file by itself, so export them in your terminal:

```bash
export APP_ENV=development
export SELFAUTH_APP_BASE_URL=http://localhost:5173
export DATABASE_URL=file:./app.db
```

Then create the tables, write the roles, and start it. Permissions go in `selfauth.config.json`, under `authorization`, just as in [chapter 5](/express/permissions); run the seed again after changing them.

```bash
npx selfauth db migrate
go run ./cmd/seed
go run ./cmd/server
```

The HTTP API is identical, so the curl commands in [chapter 2](/express/run-and-sign-in) work unchanged.

## Where things are

| What | Express | Gin |
| --- | --- | --- |
| Your routes | `src/routes/index.ts` | `internal/routes/routes.go` |
| Configuration | `src/config/selfauth.config.ts` | `selfauth.config.json` |
| Migrations | `prisma/migrations/` | `db/migrations/` |
| Seed | `npm run db:seed` | `go run ./cmd/seed` |
| Make an admin | `npm run db:create-admin -- you@example.com` | `go run ./cmd/create-admin you@example.com` |
| Tests | `npm test` | `go test ./...` |

## Routes

`Register(r, a, db)` in `internal/routes/routes.go` receives the router, SelfAuth, and `db`, your handle on the database: `db.SQL` (a `*sql.DB`) on PostgreSQL, MySQL and SQLite, or `db.Mongo` on MongoDB.

```go
// The signed-in user's own notes, newest first.
api.GET("/notes", a.RequirePermission("notes.view"), func(c *gin.Context) {
	rows, err := db.SQL.QueryContext(c, `SELECT id, text FROM notes WHERE owner_id = ? ORDER BY created_at DESC`, a.Context(c).UserID)
	if err != nil {
		_ = c.Error(err)
		return
	}
	defer rows.Close()
	notes := []gin.H{}
	for rows.Next() {
		var id, text string
		if err := rows.Scan(&id, &text); err != nil {
			_ = c.Error(err)
			return
		}
		notes = append(notes, gin.H{"id": id, "text": text})
	}
	c.JSON(http.StatusOK, gin.H{"notes": notes})
})
```

`a.RequirePermission` refuses the request before your function runs, and `a.Context(c).UserID` is the signed-in user. Add it inside `Register`, after the `/hello` route. PostgreSQL writes placeholders as `$1` rather than `?`.

## Migrations

Go projects keep plain SQL files. To add the notes table, create a folder under `db/migrations/` named with the date and a description, holding a `migration.sql`:

```text
db/migrations/20261119120000_add_notes/migration.sql
```

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX notes_owner_id_idx ON notes (owner_id);
```

Then review and apply it, as in [chapter 6](/express/add-a-table):

```bash
npx selfauth db plan
npx selfauth db migrate
```

The [Go server reference](/reference/server-go) lists every guard and helper.
