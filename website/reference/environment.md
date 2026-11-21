---
title: Environment variables
description: Every environment variable a generated SelfAuth project reads, which are required, their defaults and how to set them in development and production for Node and Go projects.
keywords: [environment variables, .env, SELFAUTH_APP_BASE_URL, DATABASE_URL, NODE_ENV, APP_ENV, SELFAUTH_CSRF_SECRET, PORT]
---

# Environment variables

Environment variables hold the things that differ between your laptop and production: secrets and addresses. How the code behaves is set in the [configuration file](./config-file) instead.

## The variables

| Variable | Required | Default | Used by | Meaning |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | Express, Fastify | `development`, `test` or `production`. `production` turns on strict checks |
| `APP_ENV` | no | `development` | Gin, Flask | The same, for Go and Python |
| `PORT` | no | `3000` | all | Port to listen on (1 – 65535) |
| `HOST` | no | `0.0.0.0` | Fastify | Interface to listen on |
| `SELFAUTH_APP_BASE_URL` | yes | – | all | Address of your frontend, used to build email links |
| `DATABASE_URL` | for a real database | – | all | Connection string. If unset in development the in-memory store is used. Required in production |
| `SELFAUTH_CSRF_SECRET` | with `csrf.mode: "token"` | – | all | 32 or more random bytes, base64url |
| `SELFAUTH_CSRF_SECRET_PREVIOUS` | no | – | all | The old secret, accepted while rotating |
| `SELFAUTH_CONFIG` | no | `selfauth.config.json` | Gin, Flask | Path to the configuration file |
| `SELFAUTH_API_TARGET` | no | `http://localhost:3000` | Vite dev server | Where the dev server forwards `/auth` and `/api` |

If a value is invalid the server stops at startup and lists every problem:

```text
Invalid environment:
  - SELFAUTH_APP_BASE_URL is required (used to build email links)
```

### `SELFAUTH_APP_BASE_URL`

It must be an absolute `http` or `https` address with no spaces or control characters, and in production it has to be `https`. With a generated frontend the development value is `http://localhost:5173`. Verification and reset links are built from it (`<url>/verify-email#token=…`), and its origin is trusted for CSRF and CORS.

### `DATABASE_URL`

| Database | Format |
| --- | --- |
| PostgreSQL | `postgresql://user:password@host:5432/dbname` |
| MySQL | `mysql://user:password@host:3306/dbname` |
| SQLite | `file:./app.db` |
| MongoDB | `mongodb://host:27017/dbname` |

URL-encode special characters in the password: `@` becomes `%40`, `#` becomes `%23` and `/` becomes `%2F`.

### CSRF secret

You only need this for [cross-site setups](./frontend-deployment#_3-cross-site-different-registrable-domains). To generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

To rotate it, set the new value as `SELFAUTH_CSRF_SECRET`, move the old one to `SELFAUTH_CSRF_SECRET_PREVIOUS` for a while, and remove it once old tokens have expired.

## Email provider variables

These are not read by SelfAuth itself: they are read by the mailer you add before production, in `src/email/mailer.ts` (Express, Fastify), `internal/email/mailer.go` (Gin) or `app/mailer.py` (Flask). Without a mailer, development prints emails in the terminal and production refuses to start. Set only the variables for your provider; the [email section](/email/) has the code and where to find each value.

| Provider | Variables | Notes |
| --- | --- | --- |
| [Resend](/email/resend) | `RESEND_API_KEY`, `MAIL_FROM` | The key starts with `re_` |
| [Postmark](/email/postmark) | `POSTMARK_SERVER_TOKEN`, `MAIL_FROM` | The server's API token |
| [SendGrid](/email/sendgrid) | `SENDGRID_API_KEY`, `MAIL_FROM` | The key starts with `SG.` |
| [Mailgun](/email/mailgun) | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAIL_FROM`, and `MAILGUN_BASE_URL` for EU accounts | `MAILGUN_BASE_URL` is `https://api.eu.mailgun.net`; leave it out for the US region |
| [Brevo](/email/brevo) | `BREVO_API_KEY`, `MAIL_FROM` | |
| [SMTP and Amazon SES](/email/smtp) | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, and `SMTP_PORT` | `SMTP_PORT` is `587` if you leave it out, or `465` |

`MAIL_FROM` is the sender, on a domain you've verified with the provider: `Notes <login@mail.example.com>`. Treat the keys as secrets: set them in your hosting platform, never commit them.

## Where to set them

### Development

| Project | How |
| --- | --- |
| Express, Fastify | Copy `.env.example` to `.env` (full stack: `server/.env`). The npm scripts load it with `node --env-file-if-exists=.env` |
| Flask | Copy `.env.example` to `.env` (full stack: `server/.env`). The server loads it by itself in development; variables already set in the environment win |
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

`.env` is ignored by git. `.env.example` only has placeholders and is committed. Never commit real secrets.

### Production

Set variables in your hosting platform, whether that's container environment settings, a service dashboard or a secrets manager. A typical production set:

```ini
NODE_ENV=production            # Gin and Flask: APP_ENV=production
SELFAUTH_APP_BASE_URL=https://app.example.com
DATABASE_URL=...               # required
```

If you use `csrf.mode: "token"`, set `SELFAUTH_CSRF_SECRET` as well. See [Going to production](/express/production).

## Add your own variable

Read it in the same place as the others, so a missing value stops the server at startup:

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

Then add it to the `Env` type and to `.env.example`.
