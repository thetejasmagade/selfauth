---
title: Protect routes
description: How to require a signed-in user, a permission or ownership of a resource on a route. Covers requireAuth, requirePermission, authorizeResource and the deny-by-default protectedRoutes helper, with the exact HTTP results.
keywords: [requireAuth, requirePermission, authorizeResource, protectedRoutes, guards, 401, 403, 404, authorization]
---

# Protect routes

A guard is a function that runs before your handler and either lets the request through or stops it with an error. SelfAuth gives you three of them, plus a helper that makes guards mandatory.

## The three guards

| Guard | Question it answers | When it fails |
| --- | --- | --- |
| `requireAuth` | Is someone signed in? | `401 UNAUTHENTICATED` |
| `requirePermission("x.y")` | Is someone signed in and do they hold permission `x.y`? | `401 UNAUTHENTICATED` without a session, `403 FORBIDDEN` without the permission |
| `authorizeResource("x.y", getResource)` | May this user do `x.y` to this particular object? | `401`, `403`, or `404 NOT_FOUND` when they may not know it exists |

In the code: Express `auth.requireAuth`, Fastify `auth.requireAuth`, Gin `a.RequireAuth()` (with parentheses, because it returns the guard).

## Require a permission

The permission has to be declared and given to a role first (see [Permissions and roles](./permissions-roles)). Then:

::: code-group

```ts [Express]
api.get("/reports", auth.requirePermission("reports.view"), (_req, res) => {
  res.json({ reports: [] });
});
```

```ts [Fastify]
app.get("/api/reports", { preHandler: auth.requirePermission("reports.view") }, async () => {
  return { reports: [] };
});
```

```go [Gin]
api.GET("/reports", a.RequirePermission("reports.view"), func(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"reports": []string{}})
})
```

:::

A user without the permission sees:

```text
HTTP/1.1 403 Forbidden

{"error":{"code":"FORBIDDEN","message":"...","requestId":"..."}}
```

Typos get caught at startup. `requirePermission("reprots.view")` throws as soon as the route is defined, because that permission isn't in your configuration (in Gin it panics). You find out when you start the server, not when a user hits the route.

## Several guards

In Express you can pass several handlers. Fastify takes an array of `preHandler`s, and in Gin you list them one after another.

::: code-group

```ts [Express]
api.post("/reports", auth.requirePermission("reports.create"), validateBody, handler);
```

```ts [Fastify]
app.post("/api/reports", { preHandler: [auth.requirePermission("reports.create"), validate] }, handler);
```

```go [Gin]
api.POST("/reports", a.RequirePermission("reports.create"), validate, handler)
```

:::

## Deny by default with `protectedRoutes`

The trouble with guards is forgetting one. `protectedRoutes` flips that: a route is refused unless a guard explicitly allowed it.

::: code-group

```ts [Express]
const routes = auth.protectedRoutes();               // wraps a new router
routes.get("/", auth.requirePermission("reports.view"), handler);
routes.get("/oops", handler);                        // forgot the guard: always 403
app.use("/api/reports", routes.router);              // mount the router
```

```ts [Fastify]
const routes = auth.protectedRoutes(app, "/api/reports");
routes.get("/", auth.requirePermission("reports.view"), handler);   // registers /api/reports/
routes.get("/oops", handler);                                        // always 403
```

```go [Gin]
routes := a.ProtectedRoutes(r.Group("/api/reports"))
routes.GET("", a.RequirePermission("reports.view"), handler)
routes.GET("/oops", handler)                       // always 403
```

:::

The methods are `get`, `post`, `put`, `patch` and `delete` (`GET`, `POST` and so on in Gin).

For each request it goes through these steps:

1. Sign-in is required, so `401` if there's no session.
2. Your guards run.
3. A final check returns `403 FORBIDDEN` unless one of the guards marked the request as authorized.
4. Your handler runs.

::: warning `requireAuth` alone does not count

Only `requirePermission` and `authorizeResource` mark a request as authorized, so a route inside `protectedRoutes` with just `requireAuth` gets `403`. That's on purpose: being signed in isn't an authorization decision. If you want every signed-in user through, either create a permission all default roles hold, or keep that route on a normal router with `requireAuth`.

:::

## The decision table

| Situation | Result |
| --- | --- |
| No session cookie, or the session is expired or revoked | `401 UNAUTHENTICATED` |
| Signed in, missing the permission | `403 FORBIDDEN` |
| Signed in, a resource policy denies, and the user is not allowed to know it exists | `404 NOT_FOUND` |
| Resource type has no registered policy | `403 FORBIDDEN` |
| POST/PUT/PATCH/DELETE without the CSRF header | `403 CSRF_FAILED` |
| Too many attempts on a rate-limited auth route | `429 RATE_LIMITED` |

## Admin-only routes

The built-in administrator permissions (`auth.users.manage`, `auth.roles.assign` and the rest) belong to SelfAuth's own admin routes. For admin features of your own, define a permission such as `reports.manage` and give it to the `admin` role, or any other role, in the configuration.

