---
title: Server API (Go and Gin)
description: The Go API of the generated Gin code - ginauth.Auth, route guards, ProtectedRoutes, resource policies, OwnerFilter, the request context, the mailer and the configuration types.
keywords: [gin, go, ginauth, RequireAuth, RequirePermission, AuthorizeResource, ProtectedRoutes, OwnershipPolicy, httpx.Body]
---

# Server API (Go and Gin)

The API of the code `selfauth init --backend gin` puts in your project: `internal/ginauth` (the Gin adapter) and `internal/auth` (the core). It is your code, so you call it directly. The examples assume the module path `github.com/you/my-api`.

## Setup

`cmd/server/main.go` and `internal/app/` already do this:

```go
a, err := app.NewAuth(app.AuthOptions{
	Config: cfg, Env: env, Store: stores.Store, Mailer: mailer,
	RateLimitStore: stores.RateLimitStore, Logger: logger,
})
router, err := app.NewRouter(app.Options{Config: cfg, Auth: a, Logger: logger, Mount: routes.Register})
```

`NewAuth` refuses unsafe production settings: an insecure cookie, or an application base URL that is not `https`. `NewRouter` builds the Gin engine in a fixed order: request id and recovery, request logging, the JSON body limit, then SelfAuth's CORS, session and CSRF middleware, then `GET /health`, the `/auth` routes, your routes (`Mount`), and the 404 handler.

## `*ginauth.Auth`

| Method | What it does |
| --- | --- |
| `Middleware() []gin.HandlerFunc` | CORS, session lookup and CSRF verification. Mounted for you by `NewRouter` |
| `RegisterRoutes(group *gin.RouterGroup)` | Registers the `/auth` routes. Called by `NewRouter` |
| `Context(c) *auth.Context` | The signed-in context, or `nil`. Has `UserID`, `Roles`, `Permissions` (through the embedded `Subject`), `User` and `Session` |
| `RequireAuth() gin.HandlerFunc` | Guard: `401 UNAUTHENTICATED` without a valid session |
| `RequirePermission(p string) gin.HandlerFunc` | Guard: `401` without a session, `403 FORBIDDEN` without permission `p`. Panics when the route is defined if `p` is not declared in the configuration |
| `AuthorizeResource(p string, resource func(c *gin.Context) (resourceType, id string)) gin.HandlerFunc` | Guard that runs the policy registered for the resource type. A denied resource answers `404 NOT_FOUND`; a type with no policy answers `403 FORBIDDEN` |
| `ProtectedRoutes(group gin.IRoutes) *Protected` | Wraps a group so each route is denied unless a guard explicitly allowed it. Methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE(path, handlers...)` |
| `Policies() *auth.PolicyRegistry` | `Register(resourceType, policy)` registers a resource policy |
| `Service() *auth.Service` | The framework-independent core behind the routes, for custom flows |
| `Abort(c, err)` | Stops the request with a SelfAuth error in the standard envelope |

As in the TypeScript API, only `RequirePermission` and `AuthorizeResource` count as authorization inside `ProtectedRoutes`; `RequireAuth` alone does not. See [Protect routes](/build/protect-routes).

## Helpers in `internal/auth`

| Name | Purpose |
| --- | --- |
| `auth.OwnershipPolicy(load)` | Policy: allows an action if the subject holds it and owns the resource, or holds the `<action>_any` permission. `load func(ctx context.Context, id string) (*auth.Resource, error)` must read from storage and return `nil, nil` when the resource does not exist |
| `auth.OwnerFilter(subject, action)` | For list queries. Returns `(ownerID, all, ok)`: filter by `ownerID` unless `all`; `ok` is false when the subject holds neither permission |
| `auth.Resource` | `{ Type, ID, OwnerID string }` |
| `auth.Subject` | `{ UserID string, Roles []string, Permissions map[string]struct{} }` with `Has(permission) bool` |
| `auth.ResourcePolicy` | Interface with `Load(ctx, id)` and `Authorize(subject, action, resource) bool`, for rules other than ownership |
| `auth.Fail(code)` | Creates a SelfAuth error. Codes: `auth.Unauthenticated`, `auth.Forbidden`, `auth.NotFound`, `auth.ValidationFailed`, and so on |
| `auth.MemoryMailer`, `auth.NewDevConsoleMailer(production bool)` | Mailers for tests and development |
| `auth.Mailer` | Interface your provider implements: `Send(ctx, EmailMessage) error` |
| `auth.RoleDefinitions(cfg)` | The role map the seed writes to the database |

## Helpers in `internal/httpx`

| Name | Purpose |
| --- | --- |
| `httpx.Body(c) auth.Input` | The JSON object already parsed by SelfAuth's middleware (an empty map if none). Use it instead of `c.ShouldBindJSON` |
| `httpx.WriteError(c, status, code, message, details)` | Writes the standard error envelope |
| `httpx.AssignRequestID()`, `httpx.Recovery(logger)`, `httpx.RequestLog(logger)`, `httpx.JSONBody(limit)` | The middleware `NewRouter` installs |

## Configuration and environment (`internal/config`)

| Name | Purpose |
| --- | --- |
| `config.Load(path)` | Reads, strictly decodes and validates `selfauth.config.json` |
| `config.Parse(raw []byte)` | The same for bytes (used in tests) |
| `config.LoadEnv(lookup)` | Reads and validates the environment (`APP_ENV`, `PORT`, `SELFAUTH_APP_BASE_URL`, ...). Returns every problem at once |
| `config.OSLookup` | `lookup` for the real process environment |
| `Env.Production()` | True when `APP_ENV=production` |

## Stores (`internal/store`)

`store.New(ctx, cfg, env)` returns PostgreSQL when `DATABASE_URL` is set, otherwise the in-memory store in development. In production without `DATABASE_URL` it returns an error. The `auth.Store` and `auth.RateLimitStore` interfaces are what a store implements; `internal/store/storetest` holds the shared tests every store must pass.

## Example: a guarded route

```go
func Register(r *gin.Engine, a *ginauth.Auth) {
	api := r.Group("/api")
	api.GET("/me", a.RequireAuth(), func(c *gin.Context) {
		ctx := a.Context(c)
		c.JSON(http.StatusOK, gin.H{"email": ctx.User.Email, "roles": ctx.Roles})
	})
}
```

A complete example with ownership is in [Resources and ownership](/build/resource-ownership).
