---
title: "4. Add endpoints"
description: Add your own Gin endpoints next to SelfAuth, one anyone can call and one only signed-in users can call, read the request body safely and return errors in the standard format.
keywords: [gin route, add endpoint, RequireAuth, a.Context, httpx.WriteError, httpx.Body, validation, public route]
---

# 4. Add endpoints

Your endpoints go in `internal/routes/routes.go`. Open it. It has one endpoint so far:

```go
api := r.Group("/api")
api.GET("/hello", a.RequireAuth(), func(c *gin.Context) {
	database := "in-memory"
	if db.SQL != nil || db.Mongo != nil {
		database = "connected"
	}
	c.JSON(http.StatusOK, gin.H{"hello": a.Context(c).User.Email, "database": database})
})
```

Three parts to notice:

- **`a.RequireAuth()`** is a *guard*. Gin runs it before your function, and it answers `401` if nobody's signed in. Your function only runs for signed-in users.
- **`a.Context(c)`** tells you who's calling: `.UserID`, `.User.Email` and `.Roles`, and `.Has("notes.view")` checks a permission. It's always worked out on the server from the session, so the caller can't fake it.
- **`r.Group("/api")`** puts all of these under `/api`, so this one is `/api/hello`.

## A public endpoint

Some endpoints don't need anyone to be signed in, like a status page. Leave the guard out. Add this above `/hello`:

```go
// Anyone can call this one.
api.GET("/about", func(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"app": "notes", "version": 1})
})
```

Save, stop the server with Ctrl+C and start it again with `go run ./cmd/server`. Try it without signing in:

```bash
curl localhost:3000/api/about
```

```json
{"app":"notes","version":1}
```

## An endpoint that reads what you send

Now one that takes a message in the request body and sends it back with your email. Add two imports at the top of the file, next to the others:

```go
"notes-app/internal/auth"
"notes-app/internal/httpx"
```

Then add the endpoint below `/hello`:

```go
// Only signed-in users, with what they sent.
api.POST("/echo", a.RequireAuth(), func(c *gin.Context) {
	message, ok := httpx.Body(c)["message"].(string)
	if !ok || len(message) > 200 {
		httpx.WriteError(c, http.StatusBadRequest, auth.ValidationFailed, "message must be text, at most 200 characters.", nil)
		return
	}
	c.JSON(http.StatusOK, gin.H{"from": a.Context(c).User.Email, "message": message})
})
```

Never trust the body. Anyone can send anything, so check the type and the size before you use it. `httpx.Body(c)` is the JSON body as a map, already size-limited and parsed by SelfAuth. The `.(string)` with `ok` checks the value really is text. `httpx.WriteError` gives the caller the same error format SelfAuth uses everywhere.

Restart the server, sign in again (the commands are in [chapter 2](./run-and-sign-in)), then:

```bash
curl "${H[@]}" localhost:3000/api/echo -d '{"message":"hi there"}'
```

```json
{"from":"maya@example.com","message":"hi there"}
```

## Check it worked

Send something that isn't text:

```bash
curl "${H[@]}" localhost:3000/api/echo -d '{"message":42}'
```

```json
{"error":{"code":"VALIDATION_FAILED","message":"message must be text, at most 200 characters.","requestId":"26352d34-398c-4e76-b0d5-73b32a2f6bc3"}}
```

And call it without a session. Here that means without `-b jar`:

```bash
curl -s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' localhost:3000/api/echo -d '{"message":"hi"}'
```

```json
{"error":{"code":"UNAUTHENTICATED","message":"Authentication required.","requestId":"4edca35b-cc35-4429-811a-905f9253f2f3"}}
```

## Things to keep in mind

- **Every endpoint that changes something needs the CSRF header.** That's already true for `/api/echo`. A `POST` without `X-SelfAuth-CSRF: 1` is refused before your code runs. The generated React and Vue clients send it for you.
- **Put routes under `/api`.** With a frontend, the development server forwards `/api` and `/auth` to Go, so these paths work from the browser without extra setup.
- **Errors you didn't plan for:** call `_ = c.Error(err)` and `return`. The app answers `500` with the standard error format and logs the details on the server, never to the caller. You'll use it for database errors in chapter 7.
- **Want every route in a group guarded?** `a.ProtectedRoutes(r.Group("/api/admin"))` gives you a group where a route without a guard is refused rather than open. The [Go server reference](/reference/server-go) shows it.
- **When the file grows,** move groups of routes into their own files in the same package. You'll do that for the notes in [chapter 7](./notes-endpoints).

## If something went wrong

- **`NOT_FOUND`.** The path is wrong, or the server is still running the old code. Stop it and start it again.
- **`CSRF_FAILED`.** The request is a `POST` and the header is missing. Did you use `"${H[@]}"`?
- **`undefined: httpx`** or **`undefined: auth`.** Add the two imports at the top of the file.
- **`"notes-app/internal/auth" imported and not used`.** Go refuses to build with unused imports. Remove the ones you don't use yet.

Next: [Add permissions](./permissions)
