---
title: "4. Add endpoints"
description: Add your own Express endpoints next to SelfAuth, one anyone can call and one only signed-in users can call, read the request body safely and return errors in the standard format.
keywords: [express route, add endpoint, requireAuth, auth.context, HttpError, validation, public route]
---

# 4. Add endpoints

Your endpoints go in `src/routes/index.ts`. Open it. It has one endpoint so far:

```ts
api.get("/hello", auth.requireAuth, (_req, res) => {
  res.json({ hello: auth.context(res)!.user.email, database: db ? "connected" : "in-memory" });
});
```

Three parts to notice:

- **`auth.requireAuth`** is a *guard*. It runs before your function and answers `401` if nobody's signed in. Your function only runs for signed-in users.
- **`auth.context(res)`** tells you who's calling: `.userId`, `.user.email`, `.roles` and `.permissions`. It's always worked out on the server from the session, so the caller can't fake it.
- **`app.use("/api", api)`** at the bottom puts all of these under `/api`, so this one is `/api/hello`.

## A public endpoint

Some endpoints don't need anyone to be signed in, like a status page. Leave the guard out. Add this above the `/hello` endpoint:

```ts
// Anyone can call this one.
api.get("/about", (_req, res) => {
  res.json({ app: "notes", version: 1 });
});
```

Save. The server restarts by itself. Try it without signing in:

```bash
curl localhost:3000/api/about
```

```json
{"app":"notes","version":1}
```

## An endpoint that reads what you send

Now one that takes a message in the request body and sends it back with your email. First import `HttpError` at the top of the file:

```ts
import { HttpError } from "../http/errors.ts";
```

Then add the endpoint below `/hello`:

```ts
// Only signed-in users, with what they sent.
api.post("/echo", auth.requireAuth, (req, res) => {
  const message = req.body?.message;
  if (typeof message !== "string" || message.length > 200) {
    throw new HttpError(400, "VALIDATION_FAILED", "message must be text, at most 200 characters.");
  }
  res.json({ from: auth.context(res)!.user.email, message });
});
```

Never trust the body. Anyone can send anything, so check the type and the size before you use it. Throwing an `HttpError` gives the caller the same error format SelfAuth uses everywhere, and the user never sees a stack trace.

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
{"error":{"code":"VALIDATION_FAILED","message":"message must be text, at most 200 characters.","requestId":"50092ce7-4f51-4bb8-a9f0-ecafc20ff2c1"}}
```

And call it without a session. Here that means without `-b jar`:

```bash
curl -s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' localhost:3000/api/echo -d '{"message":"hi"}'
```

```json
{"error":{"code":"UNAUTHENTICATED","message":"Authentication required.","requestId":"8d9b96d4-3798-41ed-9e04-b1e014c19a6c"}}
```

## Things to keep in mind

- **Every endpoint that changes something needs the CSRF header.** That's already true for `/api/echo`. A `POST` without `X-SelfAuth-CSRF: 1` is refused before your code runs. The generated React and Vue clients send it for you.
- **Put routes under `/api`.** With a frontend, the development server forwards `/api` and `/auth` to Express, so these paths work from the browser without extra setup.
- **When the file grows,** move groups of routes into their own files. You'll do that for the notes in [chapter 7](./notes-endpoints).

## If something went wrong

- **`NOT_FOUND`.** The path is wrong, or the file didn't save. Check the server's terminal for a restart message.
- **`CSRF_FAILED`.** The request is a `POST` and the header is missing. Did you use `"${H[@]}"`?
- **`HttpError is not defined`.** Add the import at the top of the file.

Next: [Add permissions](./permissions)
