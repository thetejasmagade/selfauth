---
title: Try the authentication flow
description: Register, verify an email, sign in, call a protected route and trigger the rate limit using curl against your new SelfAuth project, with the real responses.
keywords: [register, login, verify email, curl, session cookie, csrf header, rate limit, example]
---

# Try the authentication flow

You will now act as a user would, with `curl`. This shows what every part of the generated API does, and what its answers look like. Have the server from the [quick start](./quick-start) running.

If you used a frontend, you can do the same in the browser at `http://localhost:5173`. The calls below are what those pages send.

## Setup: a shortcut for the repeated options

Every state-changing request needs two things:

- `Content-Type: application/json`, because bodies are JSON;
- `X-SelfAuth-CSRF: 1`, which proves the request comes from your own app and not from another website ([CSRF](/guide/concepts)).

A cookie file (`jar`) stores the session cookie between commands, as a browser would.

::: code-group

```bash [macOS / Linux / Git Bash]
H=(-s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' -b jar -c jar)
```

```powershell [PowerShell]
# PowerShell's curl is an alias. Call curl.exe and repeat the options in each command:
#   curl.exe -s -H "Content-Type: application/json" -H "X-SelfAuth-CSRF: 1" -b jar -c jar ...
```

:::

The examples below use `"${H[@]}"`, which expands to those options.

## 1. Register

```bash
curl -i "${H[@]}" localhost:3000/auth/register \
  -d '{"email":"me@example.com","password":"correct horse battery staple"}'
```

**Output:**

```text
HTTP/1.1 202 Accepted

{"status":"accepted"}
```

`202 Accepted` means "request received". It is the same answer whether or not the email already had an account, so the response cannot be used to find out who is registered.

## 2. Read the verification email

In development nothing is really sent. The email is printed in the terminal where the server runs:

```text
[dev mail] to=me@example.com kind=verification
Verify your email address
Open this link to verify your email address: http://localhost:5173/verify-email#token=I_zqMio5ZQj_3fWbS_2T4srUQmE_H6pQhBlrSj3FyoQ
```

Copy the part after `token=`. It is a one-time token that expires after 24 hours. (The token is in the URL *fragment*, after `#`, so it is never sent to servers or written to logs.)

## 3. Try to sign in too early

```bash
curl "${H[@]}" localhost:3000/auth/login \
  -d '{"email":"me@example.com","password":"correct horse battery staple"}'
```

**Output:**

```text
{"error":{"code":"EMAIL_NOT_VERIFIED","message":"Please verify your email address before signing in.","requestId":"0d4ed58d-710a-4630-b87e-25368ef2b814"}}
```

## 4. Verify the email

Replace `PASTE_TOKEN_HERE` with the token you copied:

```bash
curl "${H[@]}" localhost:3000/auth/email/verify -d '{"token":"PASTE_TOKEN_HERE"}'
```

**Output:**

```text
{"status":"verified"}
```

## 5. Sign in

```bash
curl "${H[@]}" localhost:3000/auth/login \
  -d '{"email":"me@example.com","password":"correct horse battery staple"}'
```

**Output:**

```text
{"user":{"id":"e999ceff-aa50-4f6f-bc61-ea5c0d1cc7c8","email":"me@example.com","emailVerified":true,"state":"active","roles":["user"],"permissions":[]}}
```

The session cookie is now in the `jar` file. In development it is named `dev_session`, and it is `HttpOnly`. In production it is `__Host-session` and `Secure`.

## 6. Call a protected route

```bash
curl "${H[@]}" localhost:3000/api/hello
```

**Output:**

```text
{"hello":"me@example.com"}
```

Compare with the `401` you got before signing in.

## 7. Ask who you are

```bash
curl "${H[@]}" localhost:3000/auth/me
```

**Output:**

```text
{"user":{"id":"e999ceff-aa50-4f6f-bc61-ea5c0d1cc7c8","email":"me@example.com","emailVerified":true,"state":"active","roles":["user"],"permissions":[]},"session":{"id":"4ce21afa-f526-4452-9861-b8ec4ecf46c2","createdAt":"2026-11-18T11:36:12.703Z","idleExpiresAt":"2026-11-25T11:36:12.703Z","absoluteExpiresAt":"2026-12-18T11:36:12.703Z"}}
```

Frontends call this on page load to find out whether the user is signed in.

## 8. See the CSRF protection

Leave out the CSRF header:

```bash
curl -s -b jar -H 'Content-Type: application/json' -X POST localhost:3000/auth/logout
```

**Output:**

```text
{"error":{"code":"CSRF_FAILED","message":"Request origin could not be verified.","requestId":"9d32d091-fc1b-4c83-a135-51cebeb20fd5"}}
```

A browser on another website could send your cookie but could not add that header. This protects every `POST`, `PUT`, `PATCH` and `DELETE` in your app, not only `/auth`.

## 9. See the rate limit

Five wrong passwords for one account in 15 minutes is the default limit:

```bash
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code} " "${H[@]}" localhost:3000/auth/login \
    -d '{"email":"me@example.com","password":"bad password here"}'
done
```

**Output:**

```text
401 401 401 401 401 429
```

The sixth attempt is refused before the password is even checked:

```text
HTTP/1.1 429 Too Many Requests
Retry-After: 900

{"error":{"code":"RATE_LIMITED","message":"Too many attempts. Please try again later.","requestId":"c7641996-a949-4aa8-a83a-dc813c1badab"}}
```

## 10. Sign out

```bash
curl -i "${H[@]}" -X POST localhost:3000/auth/logout
```

**Output:** `HTTP/1.1 204 No Content`. The session is revoked in the database and the cookie is cleared.

## Making an administrator

Nobody can make themselves an administrator through the API. The first one is made by you, on the server, with a script, after that person has registered and verified their email:

```bash
npm run db:create-admin you@example.com        # TypeScript projects
go run ./cmd/create-admin you@example.com      # Gin projects
```

The script needs a database. It is not available with the in-memory store, because that store forgets users when the server restarts. Run `npm run db:seed` first so the `admin` role exists. After this the admin can use the [admin routes](/api/http#administration).

## What you learned

| Observation | Where it comes from |
| --- | --- |
| Same answer for known and unknown emails | [Security model](/advanced/security#account-enumeration) |
| Cookie + CSRF header | [Frontend deployment](/configuration/frontend-deployment) |
| Rate limits | [Configuration](/configuration/config-file#rate-limits) |
| Error codes | [Error codes](/api/errors) |
