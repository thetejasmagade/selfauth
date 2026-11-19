---
title: "7. Build the notes endpoints"
description: Write the notes endpoints for a Gin (Go) SelfAuth project with database/sql, save a note, list your own notes, read one note only if it's yours and an admin-only list of everyone's, then try them as a user and as an admin.
keywords: [RequirePermission, AuthorizeResource, OwnershipPolicy, database/sql, gin handler, ownership, admin endpoint, view_any, 404]
---

# 7. Build the notes endpoints

Everything comes together here: the permissions from chapter 5 and the table from chapter 6. You'll write four endpoints, using two kinds of guard:

| Endpoint | Guard | Does |
| --- | --- | --- |
| `POST /api/notes` | `RequirePermission("notes.create")` | Saves a note for the signed-in user |
| `GET /api/notes` | `RequirePermission("notes.view")` | Lists *your own* notes |
| `GET /api/notes/:id` | `AuthorizeResource("notes.view", …)` | Reads one note, if it's yours (or you're an admin) |
| `GET /api/admin/notes` | `RequirePermission("notes.view_any")` | Lists *everyone's* notes, for admins |

`RequirePermission` asks one question: *does this user have the permission?* That's enough for saving a note or listing your own. But for `GET /api/notes/:id` it isn't: Maya has `notes.view`, yet she mustn't read Sam's note just by guessing its id. `AuthorizeResource` asks the second question too: *is this particular note theirs?*

## Write them

Create a new file next to `routes.go`, in the same package, so `routes.go` stays short:

::: code-group

```go [SQLite, MySQL: internal/routes/notes.go]
package routes

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"notes-app/internal/auth"
	"notes-app/internal/ginauth"
	"notes-app/internal/httpx"

	"github.com/gin-gonic/gin"
)

type note struct {
	ID        string    `json:"id"`
	OwnerID   string    `json:"ownerId"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"createdAt"`
}

func registerNotes(api *gin.RouterGroup, a *ginauth.Auth, db *sql.DB) {
	// How SelfAuth finds a note and its owner, for AuthorizeResource below.
	a.Policies().Register("note", auth.OwnershipPolicy(func(ctx context.Context, id string) (*auth.Resource, error) {
		var owner string
		err := db.QueryRowContext(ctx, `SELECT owner_id FROM notes WHERE id = ?`, id).Scan(&owner)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil // not found
		}
		if err != nil {
			return nil, err
		}
		return &auth.Resource{Type: "note", ID: id, OwnerID: owner}, nil
	}))

	// Save a note for the signed-in user.
	api.POST("/notes", a.RequirePermission("notes.create"), func(c *gin.Context) {
		text, _ := httpx.Body(c)["text"].(string)
		if strings.TrimSpace(text) == "" || len(text) > 2000 {
			httpx.WriteError(c, http.StatusBadRequest, auth.ValidationFailed, "text is required, at most 2000 characters.", nil)
			return
		}
		n := note{ID: rand.Text(), OwnerID: a.Context(c).UserID, Text: text, CreatedAt: time.Now().UTC()}
		_, err := db.ExecContext(c, `INSERT INTO notes (id, owner_id, text, created_at) VALUES (?, ?, ?, ?)`,
			n.ID, n.OwnerID, n.Text, n.CreatedAt)
		if err != nil {
			_ = c.Error(err)
			return
		}
		c.JSON(http.StatusCreated, gin.H{"note": n})
	})

	// The signed-in user's own notes, newest first.
	api.GET("/notes", a.RequirePermission("notes.view"), func(c *gin.Context) {
		notes, err := queryNotes(c, db, `WHERE owner_id = ? ORDER BY created_at DESC`, a.Context(c).UserID)
		if err != nil {
			_ = c.Error(err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"notes": notes})
	})

	// One note: its owner, or anyone with notes.view_any.
	noteID := func(c *gin.Context) (string, string) { return "note", c.Param("id") }
	api.GET("/notes/:id", a.AuthorizeResource("notes.view", noteID), func(c *gin.Context) {
		notes, err := queryNotes(c, db, `WHERE id = ?`, c.Param("id"))
		if err != nil || len(notes) == 0 {
			_ = c.Error(err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"note": notes[0]})
	})

	// Admins only: everyone's notes.
	api.GET("/admin/notes", a.RequirePermission("notes.view_any"), func(c *gin.Context) {
		notes, err := queryNotes(c, db, `ORDER BY created_at DESC`)
		if err != nil {
			_ = c.Error(err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"notes": notes})
	})
}

// queryNotes runs SELECT … FROM notes with the given ending (WHERE, ORDER BY) and arguments.
func queryNotes(ctx context.Context, db *sql.DB, rest string, args ...any) ([]note, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, owner_id, text, created_at FROM notes `+rest, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	notes := []note{}
	for rows.Next() {
		var n note
		if err := rows.Scan(&n.ID, &n.OwnerID, &n.Text, &n.CreatedAt); err != nil {
			return nil, err
		}
		notes = append(notes, n)
	}
	return notes, rows.Err()
}
```

```go [MongoDB: internal/routes/notes.go]
package routes

import (
	"context"
	"crypto/rand"
	"errors"
	"net/http"
	"strings"
	"time"

	"notes-app/internal/auth"
	"notes-app/internal/ginauth"
	"notes-app/internal/httpx"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type note struct {
	ID        string    `json:"id" bson:"_id"`
	OwnerID   string    `json:"ownerId" bson:"ownerId"`
	Text      string    `json:"text" bson:"text"`
	CreatedAt time.Time `json:"createdAt" bson:"createdAt"`
}

func registerNotes(api *gin.RouterGroup, a *ginauth.Auth, db *mongo.Database) {
	notes := db.Collection("notes")
	newestFirst := options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}})

	// How SelfAuth finds a note and its owner, for AuthorizeResource below.
	a.Policies().Register("note", auth.OwnershipPolicy(func(ctx context.Context, id string) (*auth.Resource, error) {
		var n note
		err := notes.FindOne(ctx, bson.M{"_id": id}).Decode(&n)
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, nil // not found
		}
		if err != nil {
			return nil, err
		}
		return &auth.Resource{Type: "note", ID: n.ID, OwnerID: n.OwnerID}, nil
	}))

	// Save a note for the signed-in user.
	api.POST("/notes", a.RequirePermission("notes.create"), func(c *gin.Context) {
		text, _ := httpx.Body(c)["text"].(string)
		if strings.TrimSpace(text) == "" || len(text) > 2000 {
			httpx.WriteError(c, http.StatusBadRequest, auth.ValidationFailed, "text is required, at most 2000 characters.", nil)
			return
		}
		n := note{ID: rand.Text(), OwnerID: a.Context(c).UserID, Text: text, CreatedAt: time.Now().UTC()}
		if _, err := notes.InsertOne(c, n); err != nil {
			_ = c.Error(err)
			return
		}
		c.JSON(http.StatusCreated, gin.H{"note": n})
	})

	// The signed-in user's own notes, newest first.
	api.GET("/notes", a.RequirePermission("notes.view"), func(c *gin.Context) {
		list, err := findNotes(c, notes, bson.M{"ownerId": a.Context(c).UserID}, newestFirst)
		if err != nil {
			_ = c.Error(err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"notes": list})
	})

	// One note: its owner, or anyone with notes.view_any.
	noteID := func(c *gin.Context) (string, string) { return "note", c.Param("id") }
	api.GET("/notes/:id", a.AuthorizeResource("notes.view", noteID), func(c *gin.Context) {
		var n note
		if err := notes.FindOne(c, bson.M{"_id": c.Param("id")}).Decode(&n); err != nil {
			_ = c.Error(err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"note": n})
	})

	// Admins only: everyone's notes.
	api.GET("/admin/notes", a.RequirePermission("notes.view_any"), func(c *gin.Context) {
		list, err := findNotes(c, notes, bson.M{}, newestFirst)
		if err != nil {
			_ = c.Error(err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"notes": list})
	})
}

func findNotes(ctx context.Context, notes *mongo.Collection, filter bson.M, opts *options.FindOptionsBuilder) ([]note, error) {
	cursor, err := notes.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	list := []note{}
	if err := cursor.All(ctx, &list); err != nil {
		return nil, err
	}
	return list, nil
}
```

:::

::: tip PostgreSQL
PostgreSQL numbers its placeholders: write `$1, $2, $3, $4` where the SQLite version has `?, ?, ?, ?`, and `$1` for a single `?`. Everything else is the same.
:::

Then connect them in `routes.go`. At the end of `Register`, add:

```go
// The notes need a database. Without one (the in-memory store) they are left out.
if db.SQL != nil {
	registerNotes(api, a, db.SQL)
}
```

On MongoDB, check `db.Mongo != nil` and pass `db.Mongo` instead. Restart the server.

## What makes this safe

- **`a.RequirePermission("notes.create")`** checks the permission before your function runs. Someone signed in without it gets `403`. Someone not signed in at all gets `401`.
- **The owner comes from the session.** `OwnerID: a.Context(c).UserID` is the signed-in user, worked out on the server. Never take an owner id from the request body, or anyone could save notes as someone else.
- **The list is filtered in the query.** `WHERE owner_id = ?` asks the database for this user's notes only. Don't load everything and filter afterwards. It's slower, and one mistake shows other people's data.
- **The values go in as placeholders,** never pasted into the SQL string. That's what keeps a note containing `'; DROP TABLE notes; --` a harmless note.
- **`AuthorizeResource` checks the one record.** It looks the note up with the function you registered under `"note"`, then allows the request if the user has `notes.view` *and* owns it, or has `notes.view_any`. That `_any` rule is why the admin list and the single-note endpoint share one permission.
- **Database errors** go to `c.Error(err)`. The caller gets a plain `500` in the standard error format, and the details stay in the server log.
- **The admin endpoint is a separate route** with its own permission. That's easier to read and to test than one endpoint that behaves differently depending on who calls it.

## Try it as Maya

Make sure Maya is signed in (`H` from chapter 5), then save two notes:

```bash
curl "${H[@]}" localhost:3000/api/notes -d '{"text":"Buy milk"}'
curl "${H[@]}" localhost:3000/api/notes -d '{"text":"Call the dentist"}'
```

```json
{"note":{"id":"MHBLAYGTRLV3CY6FCSMK4LDRIO","ownerId":"6e811164-…","text":"Buy milk","createdAt":"2026-11-19T10:12:16.12681259Z"}}
{"note":{"id":"LLTQMUJHDLCO4BOLODCQJZ343B","ownerId":"6e811164-…","text":"Call the dentist","createdAt":"2026-11-19T10:12:16.137394123Z"}}
```

The ids come from `rand.Text()`, Go's built-in random string generator. They're long enough that nobody can guess one.

List them:

```bash
curl "${H[@]}" localhost:3000/api/notes
```

```json
{"notes":[{"id":"LLTQMUJHDLCO4BOLODCQJZ343B","text":"Call the dentist",…},{"id":"MHBLAYGTRLV3CY6FCSMK4LDRIO","text":"Buy milk",…}]}
```

Now try the admin list:

```bash
curl "${H[@]}" localhost:3000/api/admin/notes
```

```json
{"error":{"code":"FORBIDDEN","message":"You do not have permission to perform this action.","requestId":"50b6c641-…"}}
```

Maya isn't an admin, so she's refused.

## Read one note

Copy the `id` of one of Maya's notes and read it:

```bash
curl "${H[@]}" localhost:3000/api/notes/MHBLAYGTRLV3CY6FCSMK4LDRIO
```

```json
{"note":{"id":"MHBLAYGTRLV3CY6FCSMK4LDRIO","ownerId":"6e811164-…","text":"Buy milk","createdAt":"2026-11-19T10:12:16.12681259Z"}}
```

Now ask for an id that doesn't exist:

```bash
curl "${H[@]}" localhost:3000/api/notes/does-not-exist
```

```json
{"error":{"code":"NOT_FOUND","message":"Not found.","requestId":"ba4aa3ef-…"}}
```

You'll try someone else's note in a moment. It gives exactly the same answer.

## Try it as Sam

Sam (`A`) saves a note of his own, then lists notes:

```bash
curl "${A[@]}" localhost:3000/api/notes -d '{"text":"Sam was here"}'
curl "${A[@]}" localhost:3000/api/notes
```

```json
{"notes":[{"id":"PQFAZRDR2BS4JJFL2KZOATBMME","ownerId":"67bd0769-…","text":"Sam was here",…}]}
```

Only his own note, even though he's an admin. Now swap: Maya asks for Sam's note, using the `id` from his list:

```bash
curl "${H[@]}" localhost:3000/api/notes/PQFAZRDR2BS4JJFL2KZOATBMME
```

```json
{"error":{"code":"NOT_FOUND","message":"Not found.","requestId":"08802500-…"}}
```

`NOT_FOUND`, not `FORBIDDEN`. Maya can't even tell the note exists, which is what you want: a "forbidden" answer would confirm that the id is real. Sam, holding `notes.view_any`, can read Maya's note at `/api/notes/<her id>`.

Back to the lists. The admin list is where Sam sees everything:

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

- **`NOT_FOUND` for every notes URL.** `registerNotes` isn't being called. Check the lines at the end of `Register`, that `DATABASE_URL` is set (without a database the notes are left out), and that you restarted the server.
- **`NOT_FOUND` for every single note, even your own.** The `"note"` in `a.Policies().Register("note", …)` must match the `"note"` that `noteID` returns, exactly.
- **`panic: policy for "note" already registered`.** `registerNotes` is called twice. Call it once, in `Register`.
- **`FORBIDDEN` for Maya on `/api/notes`.** The permissions aren't in the database. Run `go run ./cmd/seed` (chapter 5).
- **`INTERNAL_ERROR`, and the server log says `no such table: notes`.** The migration didn't run. Run `npx selfauth db migrate`.
- **A syntax error near `?` on PostgreSQL.** Use `$1`, `$2`… instead (the tip above).

Next: [Change a table later](./change-a-table)
