---
title: Environment variables
description: Every environment variable a generated SelfAuth project reads, which are required, their defaults and how to set them in development and production for Node and Go projects.
keywords: [environment variables, .env, SELFAUTH_APP_BASE_URL, DATABASE_URL, NODE_ENV, APP_ENV, SELFAUTH_CSRF_SECRET, PORT]
---

# Environment variables

Environment variables hold secrets and addresses, which differ between your computer and production. Behavior settings live in the [configuration file](./config-file).

## The variables

| Variable | Required | Default | Used by | Meaning |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | Express, Fastify | `development`, `test` or `production`. `production` turns on strict checks |
| `APP_ENV` | no | `development` | Gin | The same, for Go |
| `PORT` | no | `3000` | all | Port to listen on (1 – 65535) |
| `HOST` | no | `0.0.0.0` | Fastify | Interface to listen on |
| `SELFAUTH_APP_BASE_URL` | yes | – | all | Address of your frontend, used to build email links |
| `DATABASE_URL` | for a real database | – | all | Connection string. If unset in development the in-memory store is used. Required in production |
| `SELFAUTH_CSRF_SECRET` | with `csrf.mode: "token"` | – | all | 32 or more random bytes, base64url |
| `SELFAUTH_CSRF_SECRET_PREVIOUS` | no | – | all | The old secret, accepted while rotating |
| `SELFAUTH_CONFIG` | no | `selfauth.config.json` | Gin | Path to the configuration file |
| `SELFAUTH_API_TARGET` | no | `http://localhost:3000` | Vite dev server | Where the dev server forwards `/auth` and `/api` |

An invalid value stops the server at startup with a message listing every problem:

```text
Invalid environment:
  - SELFAUTH_APP_BASE_URL is required (used to build email links)
```

### `SELFAUTH_APP_BASE_URL`

Must be an absolute `http` or `https` address with no spaces or control characters. In production it must be `https`. With a generated frontend the development value is `http://localhost:5173`. Verification and reset links are built from it (`<url>/verify-email#token=…`), and its origin is trusted for CSRF and CORS.

### `DATABASE_URL`

| Database | Format |
| --- | --- |
| PostgreSQL | `postgresql://user:password@host:5432/dbname` |
| MySQL | `mysql://user:password@host:3306/dbname` |
| SQLite | `file:./app.db` |
| MongoDB | `mongodb://host:27017/dbname` |

URL-encode special characters in the password (`@` → `%40`, `#` → `%23`, `/` → `%2F`).

### CSRF secret

Only needed for [cross-site setups](./frontend-deployment#_3-cross-site-different-registrable-domains). Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

To rotate it, set the new value as `SELFAUTH_CSRF_SECRET` and move the old one to `SELFAUTH_CSRF_SECRET_PREVIOUS` for a while, then remove it.

## Where to set them

### Development

| Project | How |
| --- | --- |
| Express, Fastify | Copy `.env.example` to `.env` (full stack: `server/.env`). The npm scripts load it with `node --env-file-if-exists=.env` |
| Gin | The server does not read `.env`. Export the variables in your shell, or use a tool such as direnv |

```bash
# Gin, macOS / Linux
export APP_ENV=development
export SELFAUTH_APP_BASE_URL=http://localhost:5173
export DATABASE_URL=postgresql://user:password@localhost:5432/app
```

```powershell
# Gin, Windows PowerShell
$env:SELFAUTH_APP_BASE_URL = "http://localhost:5173"
```

`.env` is ignored by git. `.env.example` holds placeholders only and is committed. Never commit real secrets.

### Production

Set variables in your hosting platform (container environment, service settings, a secrets manager). Production checklist:

```ini
NODE_ENV=production            # Gin: APP_ENV=production
SELFAUTH_APP_BASE_URL=https://app.example.com
DATABASE_URL=...               # required
```

If you use `csrf.mode: "token"`, also set `SELFAUTH_CSRF_SECRET`. See [Going to production](/advanced/production).

## Add your own variable

Read it in the same place as the others so that a missing value fails at startup:

::: code-group

```ts [TypeScript: src/config/env.ts]
const smtpHost = source["SMTP_HOST"];
if (nodeEnv === "production" && !smtpHost) problems.push("SMTP_HOST is required in production");
```

```go [Go: internal/config/env.go]
if env.Production() && get("SMTP_HOST", "") == "" {
	bad("SMTP_HOST is required in production")
}
```

:::

Then add it to the `Env` type and `.env.example`.
