---
title: Troubleshooting
description: Fix common SelfAuth problems - installation errors, Node version, environment variables, DATABASE_URL, migrations, 401 and 403 responses, CSRF_FAILED, cookies, rate limits, email and Go specifics. Causes and step-by-step solutions.
keywords: [troubleshooting, errors, CSRF_FAILED, 401, 403, 429, DATABASE_URL, Unknown file extension, prisma, cookies not set, EADDRINUSE]
---

# Troubleshooting

Find your symptom, check the likely cause, apply the fix. Every message here is either copied from a real run or marked as typical.

## First, three quick checks

1. `node --version` is 22.18 or newer (Gin: `go version` is 1.26 or newer).
2. `npx selfauth doctor` and `npx selfauth validate` report no errors.
3. You restarted the server after changing the configuration or `.env`: both are read at startup only.

## Installation and startup

### Unknown file extension ".ts"

**Symptom:** `npm run dev` fails with `ERR_UNKNOWN_FILE_EXTENSION` and `Unknown file extension ".ts"` (typical message).

**Cause:** Node.js is older than 22.18. Generated projects run TypeScript directly.

**Fix:** Install a current LTS Node.js, open a **new** terminal, and check `node --version`.

### Invalid environment

**Symptom** (real output):

```text
Invalid environment:
  - SELFAUTH_APP_BASE_URL must be an http(s) URL
```

**Cause:** An environment variable is missing or malformed. All problems are listed together.

**Fix:** Edit `.env` (full stack: `server/.env`). `SELFAUTH_APP_BASE_URL` must be an absolute `http://` or `https://` address, for example `http://localhost:5173`. Check you copied `.env.example` to `.env`: the dev script says `.env not found. Continuing without it.` otherwise.

### Port already in use

**Symptom:** `Error: listen EADDRINUSE: address already in use :::3000` (typical).

**Cause:** Another program, or an earlier copy of your server, uses the port.

**Fix:** Stop the other process, or choose another port: `PORT=3001` in `.env`. If you use a generated frontend, set `SELFAUTH_API_TARGET=http://localhost:3001` for the Vite dev server.

### The server exits in production with "No email provider configured"

**Cause:** Deliberate: the mailer placeholder is still in place.

**Fix:** [Send real email](/build/email). The same applies to the other [startup errors](/advanced/production#startup-errors-you-may-meet).

### Gin: `read selfauth.config.json: open selfauth.config.json: no such file or directory`

**Cause:** You started the server from a folder that does not contain `selfauth.config.json`.

**Fix:** Run it from the project root, or set `SELFAUTH_CONFIG=/path/to/selfauth.config.json`.

### Gin: "invalid environment" although you created `.env`

**Cause:** The Go server does **not** load `.env`.

**Fix:** Export the variables in your shell (`export SELFAUTH_APP_BASE_URL=...`), or load the file with a tool such as direnv. See [Environment variables](/configuration/environment).

### Gin: build errors about the Go version

**Cause:** Gin 1.12 needs Go 1.26 or newer.

**Fix:** Upgrade Go, or let Go download the toolchain (`go.mod` says `go 1.26.0`).

## Configuration

### `selfauth validate` reports a config error

Real examples:

```text
  ✗ config authentication.password.minLength: Too small: expected number to be >=8
  ✗ config authentication.sessions.cookie: Unrecognized key: "bogus"
```

**Cause:** A value is outside the allowed range, or a key is misspelled (unknown keys are rejected on purpose).

**Fix:** Correct the named key. Ranges are in [The configuration file](/configuration/config-file).

### `Unknown permission 'x.y'` at startup

**Cause:** A guard such as `requirePermission("x.y")` names a permission that is not declared.

**Fix:** Add it to `authorization.permissions` in the configuration. See [Permissions and roles](/build/permissions-roles).

## Database

### DATABASE_URL is not set

**Symptom** (real output of `selfauth db status`):

```text
  ✗ DATABASE_URL is not set, so there is no database to connect to.
  environment variable:  not set
  /path/to/project/.env:  missing
  • Add a line like DATABASE_URL=file:./app.db to /path/to/project/.env (and save the file), or set the variable in your shell.
```

**Fix:** Add `DATABASE_URL=...` to `.env` and **save the file** (full stack: `server/.env`). A variable that is set but empty in your shell does not hide the value in `.env`. The placeholder from `.env.example` is refused.

### DATABASE_URL cannot be used

**Symptom:** `DATABASE_URL (from .env) cannot be used: it must start with "file:"...`

**Cause:** The URL does not match the project's database (for example a PostgreSQL URL in a SQLite project).

**Fix:** Use the format for your database: see [Environment variables](/configuration/environment#database-url).

### Special characters in the password

URL-encode them (`@` is `%40`, `#` is `%23`, `/` is `%2F`). Do not put quotes around the value in a shell command. In Windows `cmd`, `set DATABASE_URL=postgresql://...` takes the value as it is.

### Migrations fail on Supabase or another pooled database

**Cause:** Prisma Migrate needs session features (advisory locks, prepared statements) that a transaction-mode pooler (for example port 6543) does not provide.

**Fix:** Use the provider's **direct** connection string, or the pooler's **session** mode (port 5432), for `selfauth db plan` and `migrate`. Your running app can use the connection string you prefer.

### Error P3005: the database schema is not empty

**Cause:** The database already has tables but no Prisma migration history.

**Fix:** Baseline it with `prisma migrate resolve --applied <migration>`, and only for migrations whose objects really exist.

### `Role 'user' is missing in the database. Run the migrations and npm run db:seed first.`

**Fix:** `npm run db:seed` (Gin: `go run ./cmd/seed`).

### TypeScript or runtime error about `generated/prisma` or a missing model

**Cause:** The Prisma client is stale after a schema change.

**Fix:** `npx prisma generate`. (It also runs after `npm install`.)

### "Prisma is not installed, so the database schema was not validated"

**Fix:** Run `npm install` first.

### SQLite: "table does not exist"

**Cause:** The server started from a different folder than the migration, so the relative `file:` path points elsewhere.

**Fix:** Start the server from the project folder (the npm scripts do), or use an absolute path.

## Requests and sessions

### 401 UNAUTHENTICATED

| Likely cause | Fix |
| --- | --- |
| You did not sign in, or the session expired | Sign in again |
| `curl` does not send the cookie | Use `-b jar -c jar`, as in [Try the authentication flow](/getting-started/first-flow) |
| The browser did not store the cookie | See "The cookie is not set" below |
| The session was revoked (password change, "sign out everywhere", suspension) | Sign in again |

### 403 CSRF_FAILED

<a id="403-csrf_failed"></a>

Real output when the header is missing: `{"error":{"code":"CSRF_FAILED","message":"Request origin could not be verified.",...}}`

| Likely cause | Fix |
| --- | --- |
| The request has no `X-SelfAuth-CSRF` header | Add `X-SelfAuth-CSRF: 1`. The generated client does it for you, `fetch` does not |
| Your own `fetch` code is used for a state-changing request | Use `client.api(...)`, or add the header |
| The frontend is served from an address the backend does not trust | Set `SELFAUTH_APP_BASE_URL` to the frontend's exact address, or add it to `http.trustedOrigins` |
| Cross-site setup with `SameSite=None` | Use [token mode](/configuration/frontend-deployment) and send the token |
| `vite preview` on another port | Same as above: trust that origin |

The check covers **all** `POST`, `PUT`, `PATCH` and `DELETE` in your app, not only `/auth`.

### The cookie is not set (the browser stays signed out)

| Likely cause | Fix |
| --- | --- |
| You run in production mode over plain `http://` | `Secure` cookies are refused on `http`. Use `https`, or `NODE_ENV=development` locally |
| The frontend and API are on different origins without the right settings | Use the [proxy setup](/configuration/frontend-deployment) |
| Your `fetch` lacks `credentials: "include"` (different origins) | Add it |
| You set a `__Host-` cookie name with `secure: false` | The configuration is rejected: fix the values |
| An ad blocker or browser setting blocks third-party cookies | Use same origin |

### 403 EMAIL_NOT_VERIFIED

**Cause:** The account is `pending`: the verification link has not been used.

**Fix:** In development, copy the link from the **server terminal** (the dev mailer prints it). Or request a new link (`POST /auth/email/verification`). Links expire after 24 hours.

### 400 TOKEN_INVALID on verify or reset

**Cause:** The token expired, was already used, or is incomplete. All causes look the same on purpose.

**Fix:** Request a new link. Make sure the whole token after `token=` was copied (it is long, with no spaces).

### 429 RATE_LIMITED

**Cause:** Too many attempts (for example 5 wrong passwords in 15 minutes for one account). The `Retry-After` header says how many seconds to wait.

**Fix:** Wait. In development, restart the server to clear the in-memory counters. If **all** users are limited at once behind a proxy, set `http.trustProxy` so each client has its own address.

### 403 FORBIDDEN on your route

| Likely cause | Fix |
| --- | --- |
| The user's roles do not hold the permission | Add it to a role, seed, restart ([Permissions and roles](/build/permissions-roles)) |
| You forgot to run the seed | `npm run db:seed` |
| The route uses `protectedRoutes` and has only `requireAuth` | Use `requirePermission` or `authorizeResource` ([Protect routes](/build/protect-routes)) |
| A resource type has no registered policy | Register one with `auth.policies.register` |

### 404 on your own route

**Cause (full stack):** The Vite dev server proxies only `/auth` and `/api`.

**Fix:** Use `/api/...` paths, or add your prefix to the `proxy` in `client/vite.config.ts`.

### Gin: `c.ShouldBindJSON` finds nothing

**Cause:** SelfAuth's middleware already consumed the body.

**Fix:** Use `httpx.Body(c)["field"]`. See [Add an API route](/build/add-api-route#step-5-reading-request-data).

## Frontend

### Redirected to `/login` in a loop

**Cause:** The session cookie is not being stored or sent: see "The cookie is not set".

### The password length error shows the old number

**Cause:** The forms carry a hint of the old minimum.

**Fix:** Update the `minlength` attribute on the register, reset and account pages ([Add a frontend page](/build/frontend-pages#change-the-password-length-in-the-forms)).

## Commands

### `selfauth init` says the directory has a `package.json`

**Fix:** Use an empty folder, or [`selfauth add`](/cli/add) for an existing project.

### `selfauth add` says the tsconfig does not cover the folder

**Fix:** Add the folder to `include` in `tsconfig.json`, as the message says.

### `.selfauth-new` files appeared after an upgrade

**Cause:** You edited a generated file that the new template also changed.

**Fix:** Merge the proposal into your file, delete the `.selfauth-new` file ([details](/cli/upgrade)).

### `curl` in PowerShell behaves differently

`curl` is an alias for `Invoke-WebRequest`. Use `curl.exe`, or use Git Bash or WSL for the examples.

## Debugging techniques

1. **Read the server log.** Each request is a JSON line with `status`, `path` and a `requestId`. The `requestId` is also in the error body and the `X-Request-Id` header.
2. **Look at the response body.** The error `code` tells you the cause. Never match on `message`.
3. **Use the browser's network tab.** Check the request headers (`X-SelfAuth-CSRF`, `Cookie`) and the `Set-Cookie` response header.
4. **Reproduce with curl** and a cookie jar to separate frontend problems from API problems.
5. **Run the checks:** `npx selfauth doctor`, `npx selfauth validate`, `npm run typecheck`, `npm test`.
6. **Print the dev emails.** In development the verification and reset links appear in the server terminal.

## Still stuck?

Search the [GitHub issues](https://github.com/thetejasmagade/selfauth/issues), and open one with the command you ran, the full output, your Node.js (or Go) version, and the output of `npx selfauth doctor`. Do not paste secrets. For vulnerabilities, follow the [security policy](https://github.com/thetejasmagade/selfauth/blob/main/SECURITY.md) instead of opening an issue.
