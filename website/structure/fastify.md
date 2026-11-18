---
title: Fastify API project structure
description: The folder layout of a SelfAuth project generated for Fastify 5 and how it differs from the Express project. Where your routes go and how the adapter is wired.
keywords: [fastify, directory structure, preHandler, fastify adapter, boilerplate]
---

# Fastify API project structure

`npx selfauth init my-app --backend fastify` creates the **same project as [Express](./express)**: the same folders, scripts, configuration, stores and tests. Only the HTTP glue differs.

## What is different

| Express | Fastify |
| --- | --- |
| `src/auth/express/index.ts` | `src/auth/fastify/index.ts` |
| `app.use(auth.middleware)` and `app.use(basePath, auth.router)` | `auth.install(app)` does both (hooks and the `/auth` routes) |
| `auth.errorHandler` | `auth.handleError(error, req, reply)`, called first in `setErrorHandler` |
| `auth.context(res)` | `auth.context(req)` (also `req.selfauth`) |
| Route guards are middleware | Route guards are async `preHandler` hooks |
| Dependencies: `express`, `cookie`, `@node-rs/argon2` | Dependencies: `fastify`, `cookie`, `@node-rs/argon2` |

`HOST` sets the interface the server listens on (`0.0.0.0` by default).

## The tree (differences only)

```text
my-app/
├── src/
│   ├── app.ts                  # builds the Fastify app (body parser, body limit, 404, error handler)
│   ├── routes/index.ts         # ★ YOUR routes
│   └── auth/
│       └── fastify/index.ts    # the Fastify adapter
└── ... everything else as in the Express project
```

## Your routes

`src/routes/index.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { Auth } from "../auth/index.ts";

export function mountRoutes(app: FastifyInstance, auth: Auth): void {
  app.get("/api/hello", { preHandler: auth.requireAuth }, async (req) => {
    return { hello: auth.context(req)!.user.email };
  });
}
```

The `preHandler` option runs the guard before your handler. Add a permission check the same way:

```ts
app.get("/api/orders", { preHandler: auth.requirePermission("orders.view") }, async () => []);
```

For deny-by-default groups of routes, use `auth.protectedRoutes(app, "/api/orders")`: see [Protect routes](/build/protect-routes).

## Next

- [Add an API route](/build/add-api-route)
