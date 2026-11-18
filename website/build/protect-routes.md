---
title: Protect routes
description: How to require a signed-in user, a permission or ownership of a resource on a route. Covers requireAuth, requirePermission, authorizeResource and the deny-by-default protectedRoutes helper, with the exact HTTP results.
keywords: [requireAuth, requirePermission, authorizeResource, protectedRoutes, guards, 401, 403, 404, authorization]
---

# Protect routes

A guard is a function that runs before your handler and either lets the request through or stops it with an error. SelfAuth gives you three guards, and one helper that makes guards mandatory.

## The three guards

| Guard | Question it answers | When it fails |
| --- | --- | --- |
| `requireAuth` | Is someone signed in? | `401 UNAUTHENTICATED` |
| `requirePermission("x.y")` | Is someone signed in and do they hold permission `x.y`? | `401 UNAUTHENTICATED` without a session, `403 FORBIDDEN` without the permission |
| `authorizeResource("x.y", getResource)` | May this user do `x.y` to this particular object? | `401`, `403`, or `404 NOT_FOUND` when they may not know it exists |

In the code: Express `auth.requireAuth`, Fastify `auth.requireAuth`, Gin `a.RequireAuth()` (with parentheses, because it returns the guard).

## Require a permission

First, the permission must be declared and given to a role (see [Permissions and roles](./permissions-roles)). Then:

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

What you will see. For a user without the permission:

```text
HTTP/1.1 403 Forbidden

{"error":{"code":"FORBIDDEN","message":"...","requestId":"..."}}
```

Typos are caught at startup. `requirePermission("reprots.view")` throws when the route is defined, because that permission is not in your configuration. In Gin it panics at startup. You find the mistake when you start the server, not when a user hits the route.

## Several guards

Express accepts several handlers; Fastify accepts an array of `preHandler`s; in Gin put them one after the other.

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

The risk of guards is forgetting one. `protectedRoutes` flips the default: a route is refused unless a guard explicitly allowed it.

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

The methods are `get`, `post`, `put`, `patch` and `delete` (Gin: `GET`, `POST`, ...).

What happens inside, in order:

1. sign-in is required (`401` if not);
2. your guards run;
3. a final check refuses the request with `403 FORBIDDEN` unless a guard marked it as authorized;
4. your handler runs.

::: warning `requireAuth` alone does not count
Only `requirePermission` and `authorizeResource` mark a request as authorized. A route inside `protectedRoutes` that has only `requireAuth` is refused with `403`. This is deliberate: "signed in" is not an authorization decision. If you want any signed-in user to pass, make a permission that every default role holds, or keep that route on a normal router with `requireAuth`.
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

The built-in administrator permissions (`auth.users.manage`, `auth.roles.assign`, and so on) are for SelfAuth's own admin routes. For your own admin features, define your own permission, such as `reports.manage`, and give it to the `admin` role (or any role) in the configuration.

::: tip The server decides, always
Hiding a button in the browser is a convenience. A user can call your API directly, so every route needs its own guard on the server.
:::
