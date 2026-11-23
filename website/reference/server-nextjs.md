---
title: Server API (Next.js)
description: The TypeScript API of the generated Next.js code - withAuth, getSelfAuth, route handlers built with auth.route and auth.protect, guards, resource policies, the request context, the body reader, how the client address is read and the createAuth options.
keywords: [next.js, withAuth, getSelfAuth, auth.protect, auth.route, requirePermission, authorizeResource, route handler, app router, trustProxy, instrumentation]
---

# Server API (Next.js)

This is the API of the code `selfauth init --backend next` puts in your project: `src/auth/next/` (the Next.js binding), `src/auth/core/` (the core, the same files the Express and Fastify projects have) and `src/lib/auth.ts` (how a route reaches SelfAuth). It's your code, so you call it directly. The core, the stores, the configuration and the meaning of every guard are the same as in [Server API (TypeScript)](/reference/server-typescript); what differs is the shape of the binding, because a Next.js route handler is a function that takes a `Request` and returns a `Response`, with no application object to attach hooks to.

## Where things are

| File | What it is |
| --- | --- |
| `src/app/auth/[[...path]]/route.ts` | The one route handler for every `/auth` route. The folder must match `http.basePath`. Exports `GET`, `POST`, `PUT`, `PATCH`, `DELETE` and `OPTIONS` |
| `src/app/api/[[...path]]/route.ts` | Answers any `/api` path that has no route of its own with the standard `NOT_FOUND` error, instead of Next.js's HTML page |
| `src/app/api/**/route.ts` | Your routes |
| `src/lib/auth.ts` | `getSelfAuth()` and `withAuth(...)` |
| `src/instrumentation.ts`, `src/lib/start.ts` | Start SelfAuth when the server boots, and stop a production server that can't |
| `src/auth/next/index.ts` | The binding: cookies, CORS, CSRF, the `/auth` routes, the guards |

## `withAuth` and `getSelfAuth`

```ts
export const GET = withAuth((auth, db) =>
  auth.protect(auth.requirePermission("orders.view"), (_req, call) =>
    Response.json({ orders: [], you: call.auth.user.email }),
  ),
);
```

`withAuth(build)` returns a route handler. The first time a request arrives it starts SelfAuth (reads the environment, opens the database, builds `auth`), calls `build(auth, db)` once and keeps the result. `db` is the client for your own tables, `undefined` on the in-memory store. If SelfAuth can't start (a bad variable, an unreachable database), the request answers `500 INTERNAL_ERROR` and the reason is logged, never sent.

`getSelfAuth()` returns the same `{ auth, db }` as a promise, for code that isn't a route handler. The instance is kept on `globalThis` under `Symbol.for("selfauth.instance")` because Next.js can load a module more than once (hot reload, one copy per route): one set of stores, one rate limiter, one policy registry for the whole process. Tests put their own instance there before importing the route files ([Test your routes](/next/tests)).

Two consequences to know:

- `next build` never starts SelfAuth, so building needs no environment variables.
- Your guards are checked when the handler is built, so a permission that isn't in the configuration fails the first request to that route with `INTERNAL_ERROR`, naming the permission in the log. Changes to `src/auth/` or `selfauth.config.ts` need a restart of `next dev`.

## `Auth`

| Member | What it does |
| --- | --- |
| `handler` | The route handler for every authentication route. Used by `src/app/auth/[[...path]]/route.ts` |
| `route(handler)` | Wraps a route handler of yours that anyone may call. CORS, the session and the CSRF check run first, the response gets `X-Request-Id`, and errors become the standard envelope. `handler(req, call)`; `call.auth` is the session context or `null` |
| `protect(guard…, handler)` | Wraps a route that needs a signed-in user: `401` without one, then each guard in order, then `403` unless a guard allowed the request (deny by default). `call.auth` is never `null` |
| `preflight` | Answers a CORS preflight. Export it as `OPTIONS` next to your handlers |
| `json(req)` | Reads the JSON body as an object. An empty body is `{}`. A body over `http.bodyLimitBytes` is `413`, a wrong content type or malformed JSON is `400`. A body can be read once |
| `requireAuth` | Guard: any signed-in user. Naming it is an explicit decision to allow the request |
| `requirePermission(p)` | Guard: `403` without the permission. Throws when the handler is built if `p` isn't declared in the configuration |
| `authorizeResource(p, (req, call) => ({ type, id }))` | Guard that runs the policy registered for `type`. A denied resource answers `404`; a type with no policy answers `403` |
| `context(req)` | The session context of a request inside a wrapped handler, or `null` |
| `requestId(req)` | The id shared by the response, the logs and the security events |
| `routes` | Every authentication route as `POST /auth/login`. The [HTTP API](/reference/http) lists the same |
| `policies.register(type, policy)` | Registers a resource policy. Registering a type again replaces it, so a route file that registers its policy when its handler is built survives hot reload |
| `service` | The framework-independent core behind the routes, for custom flows |
| `hasher` | The configured Argon2id password hasher (for example, to hash a seeded admin password) |

`call` is `{ auth, params }`. `params` holds the dynamic segments of the path: for `src/app/api/notes/[id]/route.ts` it's `{ id: "…" }` (a `[...rest]` segment is an array).

## Helpers in `src/auth/index.ts`

| Name | Purpose |
| --- | --- |
| `ownershipPolicy(load)` | Policy: allows an action if the subject holds it and owns the resource, or holds the `<action>_any` permission. `load(id)` must read from storage and return `null` when the resource does not exist |
| `ownerFilter(auth, permission)` | For list queries: `{ ownerId }` to filter by, or `null` when the subject holds the `_any` permission |
| `syncRoles(store, config)` | Writes the roles and permissions from the configuration to storage (the seed) |
| `MemoryAuthStore`, `MemoryMailer`, `DevConsoleMailer`, `ManualClock`, `systemClock` | Stores, mailers and clocks for development and tests |
| `HttpError(status, code, message, details?)` | In `src/http/errors.ts`. Throw it for an error in the standard envelope |

## Errors

Anything a handler throws is turned into a response: a SelfAuth error (`AuthError`) or an `HttpError` becomes the standard envelope with its status; anything else is `500 INTERNAL_ERROR` with a generic message, and the details go to the log, redacted. The binding recognises the two error classes by name and fields, not `instanceof`, because Next.js can bundle your route with its own copy of them.

## The client address

Next.js route handlers can't see the connection, and Next.js fills in `X-Forwarded-For` only when the request has none. SelfAuth reads the visitor's address from that header using `http.trustProxy`:

| `trustProxy` | The address is… |
| --- | --- |
| a number *n* | the *n*-th entry counted from the **right** of `X-Forwarded-For`: what the *n*-th proxy from the app appended. Entries to the left, which the visitor can write, are never used |
| a list of addresses or CIDRs | the first entry from the right that isn't one of those proxies |
| `false` | unknown: the header is ignored, and the per-address rate limits share one bucket |

Anything that isn't an IP address is treated as unknown, so it can never become a rate-limit key. The generated configuration sets `1`. The [production chapter](/next/production#_4-tell-selfauth-how-many-proxies-are-in-front-of-you) says what to set where.

## `createAuth(options)`

`src/lib/auth.ts` calls it for you:

| Option | Purpose |
| --- | --- |
| `config` | `selfauth.config.ts`, validated at startup |
| `store` | `AuthStore`: `PrismaAuthStore`, `MongooseAuthStore` or `MemoryAuthStore` |
| `mailer` | `Mailer` (`src/email/mailer.ts`) |
| `appBaseUrl`, `nodeEnv` | The frontend's address for email links, and `"development"`, `"test"` or `"production"` |
| `logger` | Optional: receives one line per request and one per unexpected error (never bodies or query strings) |
| `rateLimitStore` | Optional: `PrismaRateLimitStore` to share limits across instances |
| `csrfSecret`, `csrfSecretPrevious` | Optional: for `http.csrf.mode` `"token"`, and for secret rotation |
| `clock` | Optional: for tests (`ManualClock`) |
| `socketAddress` | Optional: the TCP peer address, for platforms that expose it. Tests pass `() => "127.0.0.1"` |

In production, `createAuth` throws unless the session cookie is `secure` and `appBaseUrl` uses `https`.
