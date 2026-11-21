---
title: Troubleshooting
description: Fix common SelfAuth problems - installation errors, Node version, environment variables, DATABASE_URL, migrations, 401 and 403 responses, CSRF_FAILED, cookies, rate limits, email and Go specifics. Causes and step-by-step solutions.
keywords: [troubleshooting, errors, CSRF_FAILED, 401, 403, 429, DATABASE_URL, Unknown file extension, prisma, cookies not set, EADDRINUSE]
---

# Troubleshooting

Find the symptom that matches, check the likely cause and try the fix. Every message here is either copied from a real run or marked as typical.

## First, three quick checks

1. `node --version` is 22.18 or newer (for Gin, `go version` is 1.26 or newer; for Flask, `python3 --version` is 3.11 or newer).
2. `npx selfauth doctor` and `npx selfauth validate` report no errors.
3. You restarted the server after changing the configuration or `.env`. Both are only read at startup.

## Installation and startup

### Unknown file extension ".ts"

`npm run dev` fails with `ERR_UNKNOWN_FILE_EXTENSION` and `Unknown file extension ".ts"` (typical message).

Your Node.js is older than 22.18, and generated projects run TypeScript directly. Install a current LTS, open a new terminal and check `node --version` again.

### Invalid environment

Real output:

```text
Invalid environment:
  - SELFAUTH_APP_BASE_URL must be an http(s) URL
```

An environment variable is missing or malformed, and every problem is listed together.

Edit `.env` (`server/.env` in a full-stack project). `SELFAUTH_APP_BASE_URL` has to be an absolute `http://` or `https://` address, such as `http://localhost:5173`. Also check you actually copied `.env.example` to `.env`. Otherwise the dev script prints `.env not found. Continuing without it.`

### Port already in use

`Error: listen EADDRINUSE: address already in use :::3000` (typical message).

Another program, or an earlier copy of your own server, is using the port. Stop it, or pick another port with `PORT=3001` in `.env`. With a generated frontend, also set `SELFAUTH_API_TARGET=http://localhost:3001` for the Vite dev server.

### The server exits in production with "No email provider configured"

That's intentional: the mailer placeholder is still in place.

[Send real email](/email/) fixes it, with a ready-made mailer for each common provider. The other [startup errors](/express/production) are listed in the production guide.

### Gin: `read selfauth.config.json: open selfauth.config.json: no such file or directory`

You started the server from a folder that doesn't contain `selfauth.config.json`. Run it from the project root, or set `SELFAUTH_CONFIG=/path/to/selfauth.config.json`.

### Gin: "invalid environment" although you created `.env`

The Go server doesn't load `.env`. Export the variables in your shell (`export SELFAUTH_APP_BASE_URL=...`) or load the file with a tool like direnv. See [Environment variables](/reference/environment).

### Gin: build errors about the Go version

Gin 1.12 needs Go 1.26 or newer. Upgrade Go, or let it download the toolchain (`go.mod` says `go 1.26.0`).

## Configuration

### `selfauth validate` reports a config error

Real examples:

```text
  ✗ config authentication.password.minLength: Too small: expected number to be >=8
  ✗ config authentication.sessions.cookie: Unrecognized key: "bogus"
```

A value is outside the allowed range, or a key is misspelled (unknown keys are rejected on purpose). Correct the key it names. The allowed ranges are in [The configuration file](/reference/config-file).

### `Unknown permission 'x.y'` at startup

A guard such as `requirePermission("x.y")` names a permission that isn't declared. Add it to `authorization.permissions` in the configuration. See [Permissions and roles](/express/permissions).

## Database

### DATABASE_URL is not set

Real output of `selfauth db status`:

```text
  ✗ DATABASE_URL is not set, so there is no database to connect to.
  environment variable:  not set
  /path/to/project/.env:  missing
  • Add a line like DATABASE_URL=file:./app.db to /path/to/project/.env (and save the file), or set the variable in your shell.
```

Add `DATABASE_URL=...` to `.env` and save the file (`server/.env` in a full-stack project). A variable that's set but empty in your shell doesn't hide the value in `.env`, and the placeholder from `.env.example` is refused.

### DATABASE_URL cannot be used

You see `DATABASE_URL (from .env) cannot be used: it must start with "file:"...`

The URL doesn't match the project's database, for instance a PostgreSQL URL in a SQLite project. Use the right format from [Environment variables](/reference/environment#database-url).

### Special characters in the password

URL-encode them: `@` is `%40`, `#` is `%23` and `/` is `%2F`. Don't wrap the value in quotes in a shell command. In Windows `cmd`, `set DATABASE_URL=postgresql://...` takes the value as it is.

### Migrations fail on Supabase or another pooled database

Prisma Migrate needs session features (advisory locks, prepared statements) that a transaction-mode pooler, such as port 6543, doesn't provide. For `selfauth db plan` and `migrate`, use the provider's direct connection string or the pooler's session mode (port 5432). Your running app can keep using whichever string you prefer.

### Error P3005: the database schema is not empty

The database already has tables but no Prisma migration history.

Baseline it with `prisma migrate resolve --applied <migration>`, and only for migrations whose objects really exist.

### `Role 'user' is missing in the database. Run the migrations and npm run db:seed first.`

Run `npm run db:seed` (`go run ./cmd/seed` for Gin, `python -m app.cmd.seed` for Flask).

### TypeScript or runtime error about `generated/prisma` or a missing model

The Prisma client is stale after a schema change. Run `npx prisma generate`, which also runs after `npm install`.

### "Prisma is not installed, so the database schema was not validated"

Run `npm install` first.

### SQLite: "table does not exist"

The server started from a different folder than the migration, so the relative `file:` path points somewhere else. Start the server from the project folder (the npm scripts do), or use an absolute path.

## Requests and sessions

### 401 UNAUTHENTICATED

| Likely cause | Fix |
| --- | --- |
| You did not sign in, or the session expired | Sign in again |
| `curl` does not send the cookie | Use `-b jar -c jar`, as in [Try the authentication flow](/express/run-and-sign-in) |
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
| Cross-site setup with `SameSite=None` | Use [token mode](/reference/frontend-deployment) and send the token |
| `vite preview` on another port | Same as above: trust that origin |

The check covers every `POST`, `PUT`, `PATCH` and `DELETE` in your app, not just `/auth`.

### The cookie is not set (the browser stays signed out)

| Likely cause | Fix |
| --- | --- |
| You run in production mode over plain `http://` | `Secure` cookies are refused on `http`. Use `https`, or `NODE_ENV=development` locally |
| The frontend and API are on different origins without the right settings | Use the [proxy setup](/reference/frontend-deployment) |
| Your `fetch` lacks `credentials: "include"` (different origins) | Add it |
| You set a `__Host-` cookie name with `secure: false` | The configuration is rejected: fix the values |
| An ad blocker or browser setting blocks third-party cookies | Use same origin |

### 403 EMAIL_NOT_VERIFIED

The account is `pending`, meaning the verification link hasn't been used. In development, copy the link from the server terminal, where the dev mailer prints it, or request a new one (`POST /auth/email/verification`). Links expire after 24 hours.

### 400 TOKEN_INVALID on verify or reset

The token expired, was already used, or is incomplete. All of those look identical on purpose. Request a new link, and make sure you copied the whole token after `token=`. It's long and has no spaces.

### 429 RATE_LIMITED

Too many attempts, for example five wrong passwords in 15 minutes for one account. The `Retry-After` header says how many seconds to wait. In development, restart the server to clear the in-memory counters. If everyone gets limited at once behind a proxy, set `http.trustProxy` so each client has its own address.

### 403 FORBIDDEN on your route

| Likely cause | Fix |
| --- | --- |
| The user's roles do not hold the permission | Add it to a role, seed, restart ([Permissions and roles](/express/permissions)) |
| You forgot to run the seed | `npm run db:seed` |
| The route uses `protectedRoutes` and has only `requireAuth` | Use `requirePermission` or `authorizeResource` ([Protect routes](/express/endpoints)) |
| A resource type has no registered policy | Register one with `auth.policies.register` |

### 404 on your own route

The Vite dev server only proxies `/auth` and `/api` (full-stack projects). Use `/api/...` paths, or add your prefix to the `proxy` in `client/vite.config.ts`.

### Gin: `c.ShouldBindJSON` finds nothing

SelfAuth's middleware already consumed the body. Use `httpx.Body(c)["field"]` instead, as in [Add an API route](/express/endpoints).

## Frontend

### Redirected to `/login` in a loop

The session cookie isn't being stored or sent. See "The cookie is not set" above.

### The password length error shows the old number

The forms carry a hint of the old minimum. Update the `minlength` attribute on the register, reset and account pages ([Add a frontend page](/express/frontend-page)).

## Commands

### `selfauth init` says the directory has a `package.json`

Use an empty folder, or [`selfauth add`](/reference/cli/add) for an existing project.

### `selfauth add` says the tsconfig does not cover the folder

Add the folder to `include` in `tsconfig.json`, as the message says.

### `.selfauth-new` files appeared after an upgrade

You edited a generated file that the new template also changed. Merge the proposal into your file and delete the `.selfauth-new` file ([details](/reference/cli/upgrade)).

### `curl` in PowerShell behaves differently

In PowerShell, `curl` is an alias for `Invoke-WebRequest`. Use `curl.exe`, or run the examples from Git Bash or WSL.

## Debugging techniques

1. Read the server log. Each request is a JSON line with `status`, `path` and a `requestId`, and the same id is in the error body and the `X-Request-Id` header.
2. Look at the response body. The error `code` tells you the cause, and you should never match on `message`.
3. Use the browser's network tab to check the request headers (`X-SelfAuth-CSRF`, `Cookie`) and the `Set-Cookie` response header.
4. Reproduce the call with curl and a cookie jar, to separate frontend problems from API problems.
5. Run `npx selfauth doctor`, `npx selfauth validate`, `npm run typecheck` and `npm test`.
6. Remember that in development the verification and reset links appear in the server terminal.

## Still stuck?

Search the [GitHub issues](https://github.com/thetejasmagade/selfauth/issues). If nothing matches, open one with the command you ran, the full output, your Node.js (or Go) version and the output of `npx selfauth doctor`. Leave out any secrets. For vulnerabilities, use the [security policy](https://github.com/thetejasmagade/selfauth/blob/main/SECURITY.md) instead of an issue.
