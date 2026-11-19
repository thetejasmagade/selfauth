---
title: Add an API route
description: Step-by-step guide to adding your own endpoint to a SelfAuth project on Express, Fastify or Gin, with a public route, a signed-in route and the URL prefixes that work through the frontend proxy.
keywords: [add route, new endpoint, express router, fastify route, gin route, api/hello, routes/index.ts]
---

# Add an API route

Your routes go in one place, in the file the generated app already calls once authentication is set up:

| Backend | File | Function |
| --- | --- | --- |
| Express | `src/routes/index.ts` (full stack: `server/src/routes/index.ts`) | `mountRoutes(app, auth)` |
| Fastify | `src/routes/index.ts` | `mountRoutes(app, auth)` |
| Gin | `internal/routes/routes.go` | `Register(r, a)` |

That file runs after SelfAuth's middleware and before the 404 handler, so anything you add there already has sessions, CSRF protection and error formatting.

## Step 1: Read the example that is already there

::: code-group

```ts [Express]
export function mountRoutes(app: express.Express, auth: Auth): void {
  const api = express.Router();
  api.get("/hello", auth.requireAuth, (_req, res) => {
    res.json({ hello: auth.context(res)!.user.email });
  });
  app.use("/api", api);
}
```

```ts [Fastify]
export function mountRoutes(app: FastifyInstance, auth: Auth): void {
  app.get("/api/hello", { preHandler: auth.requireAuth }, async (req) => {
    return { hello: auth.context(req)!.user.email };
  });
}
```

```go [Gin]
func Register(r *gin.Engine, a *ginauth.Auth) {
	api := r.Group("/api")
	api.GET("/hello", a.RequireAuth(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"hello": a.Context(c).User.Email})
	})
}
```

:::

Two things in there are worth understanding:

- `auth.requireAuth` (`a.RequireAuth()` in Gin) is a guard. It runs before your handler and answers `401 UNAUTHENTICATED` if nobody's signed in.
- `auth.context(...)` gives you the signed-in user. The server works it out fresh on every request, and it holds `userId`, `roles`, `permissions`, `user` and `session`.

## Step 2: Add a public route

A route with no guard is open to everyone. That's what you want for something like a status endpoint.

::: code-group

```ts [Express]
// in mountRoutes, before app.use("/api", api)
api.get("/status", (_req, res) => {
  res.json({ ok: true });
});
```

```ts [Fastify]
app.get("/api/status", async () => ({ ok: true }));
```

```go [Gin]
api.GET("/status", func(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"ok": true})
})
```

:::

## Step 3: Add a route for signed-in users

::: code-group

```ts [Express]
api.get("/profile", auth.requireAuth, (_req, res) => {
  const { user, permissions } = auth.context(res)!;
  res.json({ email: user.email, permissions: [...permissions] });
});
```

```ts [Fastify]
app.get("/api/profile", { preHandler: auth.requireAuth }, async (req) => {
  const { user, permissions } = auth.context(req)!;
  return { email: user.email, permissions: [...permissions] };
});
```

```go [Gin]
api.GET("/profile", a.RequireAuth(), func(c *gin.Context) {
	ctx := a.Context(c)
	c.JSON(http.StatusOK, gin.H{"email": ctx.User.Email, "roles": ctx.Roles})
})
```

:::

The `!` in TypeScript tells the compiler the context isn't null. That's safe here, because the guard has already turned away anonymous requests.

## Step 4: Try it

Sign in as in [Try the authentication flow](/getting-started/first-flow), then:

```bash
curl "${H[@]}" localhost:3000/api/profile
```

Without a session you get `401 UNAUTHENTICATED`, the same as for `/api/hello`.

## Step 5: Reading request data

| Backend | JSON body | Path parameter | Query string |
| --- | --- | --- | --- |
| Express | `req.body` | `req.params["id"]` | `req.query["q"]` |
| Fastify | `req.body` (cast to your type) | `req.params` | `req.query` |
| Gin | `httpx.Body(c)["item"]` | `c.Param("id")` | `c.Query("q")` |

::: warning Gin: do not use `c.ShouldBindJSON`

SelfAuth's middleware reads and checks the request body once, before your handler runs, so the body stream is already used up. Read the parsed JSON with `httpx.Body(c)`, which returns a map. It lives in `"<your module>/internal/httpx"`.

:::

Validate whatever you read. Bodies, parameters and query values all come from the outside world.

## Rules for your routes

1. Pick a prefix the frontend proxy forwards. In a full-stack project the Vite dev server only forwards `/auth` and `/api`, so use `/api/...` or add your prefix to `proxy` in `client/vite.config.ts`.
2. Every `POST`, `PUT`, `PATCH` and `DELETE` needs the CSRF header (`X-SelfAuth-CSRF: 1`), including the ones you write. The generated frontend client adds it for you when you call `client.api(...)`.
3. Guard everything that shouldn't be public. For a safer default, see [`protectedRoutes`](./protect-routes#deny-by-default-with-protectedroutes).
4. Return errors in the standard shape, `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`, so clients can handle yours like SelfAuth's.
5. Don't log request bodies, cookies or tokens.

## Organize growing code

Once `index.ts` gets long, move groups of routes into their own files and call them from it. The next few guides do that with an `orders` file:

```ts
// src/routes/index.ts
import { orderRoutes } from "./orders.ts";
// ...
  app.use("/api/orders", orderRoutes(auth));   // Express
```

Imports in TypeScript projects end in `.ts` (`./orders.ts`). Node runs them directly, and the build rewrites them to `.js`.
