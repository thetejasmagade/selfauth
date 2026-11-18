---
title: Add an API route
description: Step-by-step guide to adding your own endpoint to a SelfAuth project on Express, Fastify or Gin, with a public route, a signed-in route and the URL prefixes that work through the frontend proxy.
keywords: [add route, new endpoint, express router, fastify route, gin route, api/hello, routes/index.ts]
---

# Add an API route

Your routes live in one place, the file that the generated app already calls after it has set up authentication:

| Backend | File | Function |
| --- | --- | --- |
| Express | `src/routes/index.ts` (full stack: `server/src/routes/index.ts`) | `mountRoutes(app, auth)` |
| Fastify | `src/routes/index.ts` | `mountRoutes(app, auth)` |
| Gin | `internal/routes/routes.go` | `Register(r, a)` |

Because it is called after SelfAuth's middleware and before the 404 handler, every route you add here already has sessions, CSRF protection and error formatting.

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

What each part does:

- `auth.requireAuth` / `a.RequireAuth()` is a guard. It runs before the handler and answers `401 UNAUTHENTICATED` when nobody is signed in.
- `auth.context(...)` returns the signed-in user. It is computed on the server for every request and holds `userId`, `roles`, `permissions`, `user` and `session`.

## Step 2: Add a public route

A route without a guard is open to everyone. Use it for things like a status page.

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

The `!` in TypeScript tells the compiler the context is not null. That is safe here because the guard already refused anonymous requests.

## Step 4: Try it

Sign in as in [Try the authentication flow](/getting-started/first-flow), then:

```bash
curl "${H[@]}" localhost:3000/api/profile
```

Without a session you get `401 UNAUTHENTICATED`, as for `/api/hello`.

## Step 5: Reading request data

| Backend | JSON body | Path parameter | Query string |
| --- | --- | --- | --- |
| Express | `req.body` | `req.params["id"]` | `req.query["q"]` |
| Fastify | `req.body` (cast to your type) | `req.params` | `req.query` |
| Gin | `httpx.Body(c)["item"]` | `c.Param("id")` | `c.Query("q")` |

::: warning Gin: do not use `c.ShouldBindJSON`
SelfAuth's middleware reads and checks the request body once, before your handler runs, so the body stream is already consumed. Read the parsed JSON with `httpx.Body(c)`, which returns a map. Importing the package: `"<your module>/internal/httpx"`.
:::

Always validate what you read. Treat every body, parameter and query value as untrusted.

## Rules for your routes

1. Choose a prefix the frontend proxy forwards. In a full-stack project the Vite dev server forwards only `/auth` and `/api`. Use `/api/...`, or add your prefix to the `proxy` in `client/vite.config.ts`.
2. Every `POST`, `PUT`, `PATCH` and `DELETE` needs the CSRF header (`X-SelfAuth-CSRF: 1`). This applies to your routes too. The generated frontend client adds it for you when you use `client.api(...)`.
3. Guard every route that is not meant to be public. For a safer default see [`protectedRoutes`](./protect-routes#deny-by-default-with-protectedroutes).
4. Errors: throw or return a SelfAuth error to get the standard format. For your own errors, return JSON in the same shape: `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`.
5. Do not log request bodies, cookies or tokens.

## Organize growing code

When `index.ts` gets long, move groups of routes into their own files and call them from it. This is exactly what the next guides do with `orders`:

```ts
// src/routes/index.ts
import { orderRoutes } from "./orders.ts";
// ...
  app.use("/api/orders", orderRoutes(auth));   // Express
```

Imports in TypeScript projects end in `.ts` (for example `./orders.ts`), which Node runs directly and the build rewrites to `.js`.
