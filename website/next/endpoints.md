---
title: "4. Add API routes"
description: Add your own Next.js route handlers next to SelfAuth with withAuth, one anyone can call and one only signed-in users can call, read the request body safely and return errors in the standard format.
keywords: [next.js route handler, add api route, withAuth, auth.protect, auth.route, requireAuth, HttpError, validation, public route]
---

# 4. Add API routes

Your API routes are `route.ts` files under `src/app/api/`. Open `src/app/api/hello/route.ts`. It has one route so far:

```ts
export const GET = withAuth((auth, db) =>
  auth.protect(auth.requireAuth, (_req, call) =>
    Response.json({ hello: call.auth.user.email, database: db ? "connected" : "in-memory" }),
  ),
);
export const OPTIONS = withAuth((auth) => auth.preflight);
```

Four parts to notice:

- **`export const GET`** is how Next.js knows this file answers `GET /api/hello`. Export `POST`, `PUT`, `PATCH` or `DELETE` the same way.
- **`withAuth((auth, db) => ...)`** starts SelfAuth the first time a request arrives, then runs your function once to build the handler. `auth` is SelfAuth, and `db` is the database client for your own tables. It's `undefined` when the app runs without a database.
- **`auth.protect(guard, handler)`** is the guard. It answers `401` if nobody's signed in, runs the guard you name, and refuses any route no guard has allowed. `auth.requireAuth` is the guard that says "any signed-in user".
- **`call.auth`** tells you who's calling: `.userId`, `.user.email`, `.roles` and `.permissions`. It's always worked out on the server from the session, so the caller can't fake it.

The last line, `OPTIONS`, answers the browser's CORS preflight. With pages and API in one app you never need it (the browser and the API share one address), but it does no harm, and you need it the day another site calls your API.

Whatever you return must be a `Response`. `Response.json(...)` is the usual way, and `{ status: 201 }` sets a status.

## A public route

Some routes don't need anyone to be signed in, like a status page. Use `auth.route` instead of `auth.protect`: it still gives you the session, the CSRF check and the standard errors, but lets everyone in. Create `src/app/api/about/route.ts`:

```ts
import { withAuth } from "../../../lib/auth.ts";

export const dynamic = "force-dynamic";

// Anyone can call this one.
export const GET = withAuth((auth) => auth.route(() => Response.json({ app: "notes", version: 1 })));
export const OPTIONS = withAuth((auth) => auth.preflight);
```

(`export const dynamic = "force-dynamic"` tells Next.js to run the function on every request instead of once at build time. Put it in every route file.)

Save. Next.js picks up the new file. Try it without signing in:

```bash
curl localhost:3000/api/about
```

```json
{"app":"notes","version":1}
```

## A route that reads what you send

Now one that takes a message in the request body and sends it back with your email. Create `src/app/api/echo/route.ts`:

```ts
import { HttpError } from "../../../http/errors.ts";
import { withAuth } from "../../../lib/auth.ts";

export const dynamic = "force-dynamic";

// Only signed-in users, with what they sent.
export const POST = withAuth((auth) =>
  auth.protect(auth.requireAuth, async (req, call) => {
    const message = (await auth.json(req))["message"];
    if (typeof message !== "string" || message.length > 200) {
      throw new HttpError(400, "VALIDATION_FAILED", "message must be text, at most 200 characters.");
    }
    return Response.json({ from: call.auth.user.email, message });
  }),
);
export const OPTIONS = withAuth((auth) => auth.preflight);
```

Never trust the body. Anyone can send anything, so check the type and the size before you use it. `auth.json(req)` reads the body for you: it refuses a body that's too large (16 KiB by default) or isn't JSON, and gives you an object whose values are `unknown`, so TypeScript makes you check each one before you use it. Throwing an `HttpError` gives the caller the same error format SelfAuth uses everywhere, and the user never sees a stack trace.

Sign in again (the commands are in [chapter 2](./run-and-sign-in)), then:

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
{"error":{"code":"VALIDATION_FAILED","message":"message must be text, at most 200 characters.","requestId":"42914e74-c33f-47fe-902a-1b54bf3fc0df"}}
```

And call it without a session. Here that means without `-b jar`:

```bash
curl -s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' localhost:3000/api/echo -d '{"message":"hi"}'
```

```json
{"error":{"code":"UNAUTHENTICATED","message":"Authentication required.","requestId":"22d5a85d-d61c-46b4-9d90-19c10e955d51"}}
```

## Things to keep in mind

- **Build every handler with `withAuth`.** A handler you export as a plain function skips the session, the CSRF check and the error format.
- **Every route that changes something needs the CSRF header.** That's already true for `/api/echo`. A `POST` without `X-SelfAuth-CSRF: 1` is refused before your code runs. The generated browser client sends it for you.
- **Put routes under `/api`.** Anything under `/api` that has no route of its own gets the standard `NOT_FOUND` error instead of Next.js's HTML page.
- **Dynamic paths.** A folder called `[id]` matches any value: `src/app/api/notes/[id]/route.ts` answers `/api/notes/123`, and `call.params["id"]` is `"123"`. You'll use that in [chapter 6](./notes).
- **Guards are checked when the handler is built.** If you name a permission that doesn't exist (you'll meet them in the next chapter), the first request to that route fails with `INTERNAL_ERROR` and the terminal says which permission, instead of the route quietly being open.

## If something went wrong

- **`NOT_FOUND`.** The path is wrong, or the file isn't named `route.ts`. The folder names are the path.
- **`CSRF_FAILED`.** The request is a `POST` and the header is missing. Did you use `"${H[@]}"`?
- **A Next.js error page in the terminal about `withAuth`.** Check the import at the top: it's `../../../lib/auth.ts`, with as many `../` as the folders you are below `src/`.

Next: [Add permissions](./permissions)
