# Server API (generated Express and Fastify code)

This is the TypeScript API of the code SelfAuth puts in your project: `src/auth/`
for `init`, `src/selfauth/auth/` for `add`. It is your code, so you call it
directly; there is no SelfAuth runtime package. A test checks that every
export and every `Auth` member, in both adapters, is documented here. The
examples use Express; [Fastify](#fastify) is the same API with the differences
listed below.

## Setup

`src/server.ts` (init) or `src/selfauth/setup.ts` (`setupSelfAuth(app)`, add)
already does this:

```ts
import { createAuth } from "./auth/index.ts";

const auth = createAuth({
  config,               // selfauth.config.ts, validated at startup
  store,                // AuthStore: PrismaAuthStore or MemoryAuthStore (store.ts)
  mailer,               // Mailer (email/mailer.ts)
  appBaseUrl,           // URL of the frontend, for email links (SELFAUTH_APP_BASE_URL)
  nodeEnv,              // "development" | "test" | "production"
  requestId,            // (res) => string, correlates logs and errors
  rateLimitStore,       // optional: PrismaRateLimitStore to share limits across instances
  csrfSecret,           // optional: Buffer ≥ 32 bytes, required for csrf mode "token"
  csrfSecretPrevious,   // optional: accepted during secret rotation
  clock,                // optional: for tests (ManualClock)
});
app.use(auth.middleware);                    // CORS, session, CSRF: before your routes
app.use(config.http.basePath, auth.router);  // the /auth routes
// … your routes …
app.use(auth.errorHandler);                  // after your routes
```

In production, `createAuth` throws unless the session cookie is `secure` and
`appBaseUrl` uses https.

## `Auth`

| Member | What it does |
| --- | --- |
| `middleware` | Array of handlers: CORS for trusted origins, session lookup, CSRF verification. Mount before every route. |
| `router` | The authentication routes ([HTTP API](http.md)). Mount at `config.http.basePath`. |
| `errorHandler` | Turns SelfAuth errors into the spec's error envelope. Mount after your routes. Other errors pass through to your own handler. |
| `context(res)` | The current session's context, or `null`: `{ userId, roles, permissions, user, session }`. Computed server-side on every request. |
| `requireAuth` | Route guard. `401 UNAUTHENTICATED` without a valid session. |
| `requirePermission(p)` | Route guard. `401` without a session, `403 FORBIDDEN` without permission `p`. Throws at startup if `p` isn't declared in the config (AUTHZ-PERM-004). |
| `authorizeResource(p, req => ({ type, id }))` | Route guard that runs the policy registered for `type`. Denied resources answer `404 NOT_FOUND`, so their existence isn't revealed (AUTHZ-RES-004). A type with no registered policy gets `403 FORBIDDEN` (AUTHZ-RES-002). |
| `protectedRoutes(router?)` | Wraps a router so each route is **denied unless a guard explicitly allowed it** (AUTHZ-CORE-001). Use `.get/.post/.put/.patch/.delete(path, guard, handler)`, then mount `.router`. |
| `policies` | `PolicyRegistry`: `policies.register(type, policy)` registers a resource policy. |
| `service` | `AuthService`, the framework-neutral core behind the routes (register, login, sessions, tokens, admin operations). Use it for custom flows, such as an admin UI calling `service.setAccountState`. |
| `hasher` | The configured Argon2id `PasswordHasher` (for example, to hash a seeded admin password). |

## Fastify

`selfauth init --backend fastify` writes `src/auth/fastify/` instead of
`src/auth/express/`. The core (`auth/core/`), the stores, the configuration, the
routes' behaviour and every guard's meaning are identical; only the HTTP glue
differs, and the same conformance suite passes against it. `createAuth` takes
`requestId: (req) => string` (Fastify's request id), and the `Auth` object has
these members in place of `middleware`, `router` and `errorHandler`:

| Member | What it does |
| --- | --- |
| `install(app)` | Call once, before your routes: adds the CORS, session and CSRF hooks and registers the authentication routes at `config.http.basePath`. |
| `handleError(error, req, reply)` | Sends a SelfAuth error as the spec's error envelope and returns `true`; returns `false` for any other error. Call it first in your `setErrorHandler`. |
| `context(req)` | As above, from the request. Also `req.selfauth`. |
| `requireAuth`, `requirePermission(p)`, `authorizeResource(p, req => ({ type, id }))` | Async `preHandler` guards that throw SelfAuth errors. Use them in a route's `preHandler`, or as the guards of `protectedRoutes`. |
| `protectedRoutes(app, prefix?)` | As above, for Fastify: `routes.get(path, guard…, handler)` registers `prefix + path` on `app`, with sign-in first, your guards, then the deny-by-default check. There is no router to mount. |

```ts
const auth = createAuth({ config, store, mailer, appBaseUrl, nodeEnv, requestId: (req) => req.id });
auth.install(app);                    // hooks and /auth routes, before your routes
const routes = auth.protectedRoutes(app, "/api/orders");
routes.get("/", auth.requirePermission("orders.view"), async (req) => {
  const filter = ownerFilter(auth.context(req)!, "orders.view");
  return db.order.findMany({ where: filter ? { userId: filter.ownerId } : {} });
});
app.setErrorHandler(async (error, req, reply) => {
  if (auth.handleError(error, req, reply)) return reply; // SelfAuth errors
  // … your own errors …
});
```

The generated `src/app.ts` also sets the JSON body parser (an empty body is
fine, a malformed one is `400 VALIDATION_FAILED`), the body limit and the
not-found handler; it is a complete example.

## Exports of `auth/index.ts`

| Export | Purpose |
| --- | --- |
| `createAuth(options)` | Builds `Auth` (above). |
| `syncRoles(store, config)` | Writes the roles and permissions from the config to storage. Run it as a seed step (`npm run db:seed`). The in-memory store runs it at startup. |
| `ownershipPolicy(load)` | Policy helper: allows an action if the subject holds the permission **and** owns the resource, or holds the `*_any` variant (AUTHZ-RES-005). `load(id)` must read the resource from storage. |
| `ownerFilter(context, permission)` | For list queries: `{ ownerId }` to filter by, or `null` when the subject holds `*_any` (AUTHZ-RES-006). |
| `MemoryAuthStore` | In-memory `AuthStore`. Refuses production via `store.ts`. |
| `DevConsoleMailer` | Development mailer that prints messages and links to the console. Refuses to run in production. |
| `MemoryMailer` | Collects messages in memory, for tests. |
| `systemClock`, `ManualClock` | Time sources. `ManualClock` lets tests move time forward (expiry, rate limits). |

Types: `Auth`, `CreateAuthOptions`, `Resource`, `Subject`, `Clock`, `Mailer`
(and, in `core/`, `AuthStore`, `RateLimitStore`, `EmailMessage`).

## Example: an owned resource

```ts
import { ownerFilter, ownershipPolicy } from "./auth/index.ts";

auth.policies.register(
  "order",
  ownershipPolicy(async (id) => {
    const o = await db.order.findUnique({ where: { id } });
    return o ? { type: "order", id: o.id, ownerId: o.userId } : null;
  }),
);

const routes = auth.protectedRoutes();
routes.get("/", auth.requirePermission("orders.view"), async (_req, res) => {
  const filter = ownerFilter(auth.context(res)!, "orders.view");
  res.json(await db.order.findMany({ where: filter ? { userId: filter.ownerId } : {} }));
});
routes.get(
  "/:id",
  auth.authorizeResource("orders.view", (req) => ({ type: "order", id: req.params.id })),
  async (req, res) => res.json(await db.order.findUnique({ where: { id: req.params.id } })),
);
app.use("/api/orders", routes.router);
```

The generated `src/routes/notes.ts` (full-stack projects) is a complete,
tested version of this pattern.
