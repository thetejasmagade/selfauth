---
title: Try the authentication flow
description: Register, verify an email, sign in, call a protected route and trigger the rate limit using curl against your new SelfAuth project, with the real responses.
keywords: [register, login, verify email, curl, session cookie, csrf header, rate limit, example]
---

# Try the authentication flow

Time to be a user for a few minutes. You'll drive the API with `curl`, which is the quickest way to see what each part does and what it answers. Keep the server from the [quick start](./quick-start) running.

If you generated a frontend, you can do all of this in the browser at `http://localhost:5173` instead. The pages send the same calls.

## Setup: a shortcut for the repeated options

Any request that changes data needs two headers:

- `Content-Type: application/json`, since bodies are JSON.
- `X-SelfAuth-CSRF: 1`, which tells the server the request came from your own app and not another website. See [CSRF](/guide/concepts) if that's new to you.

The cookie file `jar` holds the session cookie between commands, the way a browser would.

::: code-group

```bash [macOS / Linux / Git Bash]
H=(-s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' -b jar -c jar)
```

```powershell [PowerShell]
# PowerShell's curl is an alias. Call curl.exe and repeat the options in each command:
#   curl.exe -s -H "Content-Type: application/json" -H "X-SelfAuth-CSRF: 1" -b jar -c jar ...
```

:::

The examples use `"${H[@]}"` to stand for those options.

## 1. Register

```bash
curl -i "${H[@]}" localhost:3000/auth/register \
  -d '{"email":"me@example.com","password":"correct horse battery staple"}'
```

You get:

```text
HTTP/1.1 202 Accepted

{"status":"accepted"}
```

`202 Accepted` just means the request was received. You'd get the same answer whether or not the email already had an account, so nobody can use this endpoint to find out who's registered.

## 2. Read the verification email

Nothing is really sent in development. The email is printed in the terminal where the server is running:

```text
[dev mail] to=me@example.com kind=verification
Verify your email address
Open this link to verify your email address: http://localhost:5173/verify-email#token=I_zqMio5ZQj_3fWbS_2T4srUQmE_H6pQhBlrSj3FyoQ
```

Copy everything after `token=`. It's a one-time token and it expires after 24 hours. It sits in the URL fragment (after the `#`), so it never reaches a server or a log.

## 3. Try to sign in too early

```bash
curl "${H[@]}" localhost:3000/auth/login \
  -d '{"email":"me@example.com","password":"correct horse battery staple"}'
```

You get:

```text
{"error":{"code":"EMAIL_NOT_VERIFIED","message":"Please verify your email address before signing in.","requestId":"0d4ed58d-710a-4630-b87e-25368ef2b814"}}
```

## 4. Verify the email

Paste the token you copied in place of `PASTE_TOKEN_HERE`:

```bash
curl "${H[@]}" localhost:3000/auth/email/verify -d '{"token":"PASTE_TOKEN_HERE"}'
```

You get:

```text
{"status":"verified"}
```

## 5. Sign in

```bash
curl "${H[@]}" localhost:3000/auth/login \
  -d '{"email":"me@example.com","password":"correct horse battery staple"}'
```

You get:

```text
{"user":{"id":"e999ceff-aa50-4f6f-bc61-ea5c0d1cc7c8","email":"me@example.com","emailVerified":true,"state":"active","roles":["user"],"permissions":[]}}
```

The session cookie is now in `jar`. In development it's called `dev_session` and it's HttpOnly. In production it's `__Host-session` and also Secure.

## 6. Call a protected route

```bash
curl "${H[@]}" localhost:3000/api/hello
```

You get:

```text
{"hello":"me@example.com"}
```

Compare that with the `401` you saw before signing in.

## 7. Ask who you are

```bash
curl "${H[@]}" localhost:3000/auth/me
```

You get:

```text
{"user":{"id":"e999ceff-aa50-4f6f-bc61-ea5c0d1cc7c8","email":"me@example.com","emailVerified":true,"state":"active","roles":["user"],"permissions":[]},"session":{"id":"4ce21afa-f526-4452-9861-b8ec4ecf46c2","createdAt":"2026-11-18T11:36:12.703Z","idleExpiresAt":"2026-11-25T11:36:12.703Z","absoluteExpiresAt":"2026-12-18T11:36:12.703Z"}}
```

This is what a frontend calls on page load to find out whether someone is signed in.

## 8. See the CSRF protection

Now leave out the CSRF header:

```bash
curl -s -b jar -H 'Content-Type: application/json' -X POST localhost:3000/auth/logout
```

You get:

```text
{"error":{"code":"CSRF_FAILED","message":"Request origin could not be verified.","requestId":"9d32d091-fc1b-4c83-a135-51cebeb20fd5"}}
```

A page on another website could make your browser send the cookie, but it couldn't add that header. The check covers every `POST`, `PUT`, `PATCH` and `DELETE` in your app, not just the ones under `/auth`.

## 9. See the rate limit

The default limit is five wrong passwords per account in 15 minutes. Try six:

```bash
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code} " "${H[@]}" localhost:3000/auth/login \
    -d '{"email":"me@example.com","password":"bad password here"}'
done
```

You get:

```text
401 401 401 401 401 429
```

The sixth attempt is refused before the password is even looked at:

```text
HTTP/1.1 429 Too Many Requests
Retry-After: 900

{"error":{"code":"RATE_LIMITED","message":"Too many attempts. Please try again later.","requestId":"c7641996-a949-4aa8-a83a-dc813c1badab"}}
```

## 10. Sign out

```bash
curl -i "${H[@]}" -X POST localhost:3000/auth/logout
```

You get `HTTP/1.1 204 No Content`. The session is revoked in the database and the cookie is cleared.

## Making an administrator

Nobody can make themselves an administrator through the API. You do it on the server, with a script, once the person has registered and verified their email:

```bash
npm run db:create-admin you@example.com        # TypeScript projects
go run ./cmd/create-admin you@example.com      # Gin projects
```

The script needs a real database, so it won't work with the in-memory store, which forgets everyone on restart. Run `npm run db:seed` first so the `admin` role exists. After that the admin can use the [admin routes](/api/http#administration).

## What you learned

| Observation | Where it comes from |
| --- | --- |
| Same answer for known and unknown emails | [Security model](/advanced/security#account-enumeration) |
| Cookie + CSRF header | [Frontend deployment](/configuration/frontend-deployment) |
| Rate limits | [Configuration](/configuration/config-file#rate-limits) |
| Error codes | [Error codes](/api/errors) |
