---
title: "10. Test your endpoints"
description: Run the Go tests that come with a Gin SelfAuth project, then add tests for the notes endpoints against a temporary SQLite database, covering sign-in, ownership, validation and the admin permission.
keywords: [go test, gin tests, httptest, integration test, test database, MemoryMailer]
---

# 10. Test your endpoints

You've checked everything by hand with curl. Tests do the same checks for you, every time you change something, in about a second.

## The tests you already have

```bash
go test ./...
```

```text
ok  	notes-app/internal/app	0.854s
ok  	notes-app/internal/auth	0.017s
ok  	notes-app/internal/config	0.016s
ok  	notes-app/internal/routes	0.015s
ok  	notes-app/internal/store	0.011s
…
```

`internal/app` checks the wiring: registering, signing in and out, the CSRF check, the body limit, and that production refuses unsafe settings. `internal/routes/routes_test.go` checks that `/api/hello` needs a signed-in user. The rest test SelfAuth's core and your database store. None of them need your development database.

## Test the notes

The notes need a real database, so these tests make their own: a fresh SQLite file in a temporary folder, migrated from your `db/migrations/` for every test. Your development data in `app.db` is never touched, and Go deletes the folder afterwards.

Create `internal/routes/notes_test.go`:

```go
package routes_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"notes-app/internal/app"
	"notes-app/internal/auth"
	"notes-app/internal/config"
	"notes-app/internal/ginauth"
	"notes-app/internal/routes"
	"notes-app/internal/store"

	"github.com/gin-gonic/gin"
)

// notesServer builds the app exactly as cmd/server does, on a fresh SQLite database in a
// temporary folder, migrated from db/migrations. It never touches your development database.
type notesServer struct {
	t      *testing.T
	router http.Handler
	mailer *auth.MemoryMailer
}

func newNotesServer(t *testing.T) *notesServer {
	ctx := context.Background()
	cfg, err := config.Load("../../selfauth.config.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg.LocalDevelopment() // plain-http cookies, as in development
	dbURL := "file:" + filepath.Join(t.TempDir(), "test.db")
	if _, err := store.Migrate(ctx, "sqlite", dbURL, "../../db/migrations"); err != nil {
		t.Fatal(err)
	}
	conn, err := store.Connect(ctx, "sqlite", dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(conn.Close)
	if err := conn.Store.SyncRoles(ctx, auth.RoleDefinitions(cfg)); err != nil {
		t.Fatal(err)
	}
	mailer := &auth.MemoryMailer{}
	base, _ := url.Parse("http://localhost:5173")
	a, err := app.NewAuth(app.AuthOptions{
		Config: cfg, Env: config.Env{NodeEnv: "test", AppBaseURL: base},
		Store: conn.Store, RateLimitStore: conn.RateLimitStore, Mailer: mailer,
	})
	if err != nil {
		t.Fatal(err)
	}
	router, err := app.NewRouter(app.Options{Config: cfg, Auth: a, Mount: func(r *gin.Engine, a *ginauth.Auth) {
		routes.Register(r, a, conn.DB)
	}})
	if err != nil {
		t.Fatal(err)
	}
	return &notesServer{t: t, router: router, mailer: mailer}
}

// call sends one request the way a same-origin browser would, and decodes the JSON answer.
func (s *notesServer) call(method, path, body, cookie string) (int, map[string]any) {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.RemoteAddr = "192.0.2.1:1"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-SelfAuth-CSRF", "1")
	req.Header.Set("Origin", "http://localhost:5173")
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	rec := httptest.NewRecorder()
	s.router.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if strings.HasSuffix(path, "/login") && len(rec.Result().Cookies()) > 0 {
		out["cookie"] = rec.Result().Cookies()[0].String()
	}
	return rec.Code, out
}

// signUp registers, verifies and signs in a user, and returns their session cookie.
func (s *notesServer) signUp(email string) string {
	creds := `{"email":"` + email + `","password":"correct horse battery staple"}`
	s.call("POST", "/auth/register", creds, "")
	msg, ok := s.mailer.LastTo(email)
	if !ok {
		s.t.Fatalf("no verification email for %s", email)
	}
	s.call("POST", "/auth/email/verify", `{"token":"`+msg.Token+`"}`, "")
	_, login := s.call("POST", "/auth/login", creds, "")
	cookie, _ := login["cookie"].(string)
	if cookie == "" {
		s.t.Fatalf("sign-in failed for %s: %v", email, login)
	}
	return cookie
}

func TestNotesRefuseAnonymous(t *testing.T) {
	s := newNotesServer(t)
	if code, _ := s.call("GET", "/api/notes", "", ""); code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401", code)
	}
}

func TestNotesListOnlyYourOwn(t *testing.T) {
	s := newNotesServer(t)
	maya, other := s.signUp("maya@example.test"), s.signUp("other@example.test")
	if code, _ := s.call("POST", "/api/notes", `{"text":"Buy milk"}`, maya); code != http.StatusCreated {
		t.Fatalf("save: %d", code)
	}
	s.call("POST", "/api/notes", `{"text":"Not Maya's"}`, other)

	_, body := s.call("GET", "/api/notes", "", maya)
	notes, _ := body["notes"].([]any)
	if len(notes) != 1 || notes[0].(map[string]any)["text"] != "Buy milk" {
		t.Fatalf("Maya sees: %v", body)
	}
}

func TestNotesHideOtherPeoplesNotes(t *testing.T) {
	s := newNotesServer(t)
	maya, other := s.signUp("owner@example.test"), s.signUp("snoop@example.test")
	_, saved := s.call("POST", "/api/notes", `{"text":"Private"}`, maya)
	id := saved["note"].(map[string]any)["id"].(string)

	if code, _ := s.call("GET", "/api/notes/"+id, "", maya); code != http.StatusOK {
		t.Fatalf("owner: %d", code)
	}
	if code, _ := s.call("GET", "/api/notes/"+id, "", other); code != http.StatusNotFound {
		t.Fatalf("someone else: %d, want 404", code)
	}
}

func TestNotesRejectEmptyText(t *testing.T) {
	s := newNotesServer(t)
	maya := s.signUp("empty@example.test")
	if code, body := s.call("POST", "/api/notes", `{"text":"  "}`, maya); code != http.StatusBadRequest {
		t.Fatalf("got %d %v", code, body)
	}
}

func TestAdminListIsForAdmins(t *testing.T) {
	s := newNotesServer(t)
	maya := s.signUp("notadmin@example.test")
	if code, _ := s.call("GET", "/api/admin/notes", "", maya); code != http.StatusForbidden {
		t.Fatalf("got %d, want 403", code)
	}
}
```

What's going on:

- **`newNotesServer`** builds the app exactly as `cmd/server` does, but on the temporary database, with `auth.MemoryMailer` instead of real email. `MemoryMailer` keeps every email in memory, so `LastTo(email)` hands you the verification token without anyone reading a terminal.
- **`signUp`** does what you did with curl in chapter 2: register, verify, sign in. It returns the session cookie.
- **The requests never touch the network.** `httptest` hands each one straight to the router, so the tests are fast and need no free port.
- **`TestNotesListOnlyYourOwn` and `TestNotesHideOtherPeoplesNotes` are the important ones.** They prove that one user can't see another's notes, in the list or by id.

The test reads your real `selfauth.config.json`, so it checks the permissions you actually ship.

## Run them

```bash
go test ./internal/routes/ -v
```

```text
=== RUN   TestNotesRefuseAnonymous
--- PASS: TestNotesRefuseAnonymous (0.05s)
=== RUN   TestNotesListOnlyYourOwn
--- PASS: TestNotesListOnlyYourOwn (0.18s)
=== RUN   TestNotesHideOtherPeoplesNotes
--- PASS: TestNotesHideOtherPeoplesNotes (0.14s)
=== RUN   TestNotesRejectEmptyText
--- PASS: TestNotesRejectEmptyText (0.09s)
=== RUN   TestAdminListIsForAdmins
--- PASS: TestAdminListIsForAdmins (0.07s)
=== RUN   TestHelloRequiresAuthentication
--- PASS: TestHelloRequiresAuthentication (0.00s)
PASS
ok  	notes-app/internal/routes	0.543s
```

::: details PostgreSQL, MySQL or MongoDB
These tests use SQLite even if your app runs on PostgreSQL or MySQL, which works as long as your SQL runs on both. If it doesn't, point the test at a separate, empty test database instead: replace `"sqlite"` with your database (`"postgresql"` or `"mysql"`), and `dbURL` with the test database's address, read from an environment variable such as `TEST_DATABASE_URL`. Never point it at your development or production database: the tests write to it. With MongoDB, use `"mongodb"` and a test database URL, and run `npx selfauth db migrate` against it once to create the indexes.
:::

## Check it worked

Break something on purpose. In `notes.go`, change the list query from `` `WHERE owner_id = ? ORDER BY created_at DESC`, a.Context(c).UserID `` to just `` `ORDER BY created_at DESC` `` and run the tests again. The ownership test fails:

```text
--- FAIL: TestNotesListOnlyYourOwn (0.20s)
FAIL
```

Put it back. That's what the test is for.

## What you don't need to test

The security rules inside `internal/auth/` (password hashing, session expiry, rate limits, CSRF) are covered by SelfAuth's own suite of 90 security checks, run against every backend and database. Spend your tests on your own rules: who may do what, and what each endpoint accepts.

## If something went wrong

- **`open ../../selfauth.config.json: no such file or directory`.** Run `go test` from the project folder (the one with `go.mod`), and keep the test in `internal/routes/`.
- **`no verification email for …`.** The email address in `signUp` doesn't match. `LastTo` looks up the exact address.
- **The tests pass but take a little while.** Password hashing is deliberately slow. That's fine for a handful of users. Don't create hundreds in a test.

Next: [Get ready for production](./production)
