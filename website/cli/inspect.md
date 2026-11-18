---
title: selfauth detect, list, doctor and validate
description: The read-only commands. detect recommends the right command for a folder, list shows supported integrations, doctor checks production readiness and validate checks configuration and generated files. With real output.
keywords: [selfauth doctor, selfauth validate, selfauth detect, selfauth list, health check, production readiness, ci]
---

# `detect`, `list`, `doctor`, `validate`

These commands only read. Run them as often as you like.

## `selfauth detect`

```text
selfauth detect [dir] [--json]
```

Inspects a folder and tells you which SelfAuth command applies: the framework, TypeScript and ESM, the package manager, the database client, existing authentication (packages and source code), the folder where files would go, and monorepo packages.

**Output** (in a project that already uses SelfAuth):

```text
SelfAuth detect → /home/you/my-app
  • package.json: yes, framework: express, TypeScript: yes, ESM: yes, package manager: npm
  • database: none found
  • source folder: src (Express app created in src/app.ts)

Recommendation: upgrade — SelfAuth is already installed (selfauth.manifest.json): check it with doctor/validate, update it with diff/upgrade.
  ✓ selfauth doctor
  ✓ selfauth diff
```

`--json` prints the same information for scripts and coding agents (fields such as `project.framework`, `project.existingAuth` and `authSignals`).

## `selfauth list`

```text
selfauth list [--json]
```

Lists the supported backends, databases and frontends, with their status. The real output of this version:

```text
Supported integrations (selfauth init):

  Backend    express          Express 5 + TypeScript (reference implementation, 90/90 conformance cases)
             fastify          Fastify 5 + TypeScript (90/90 conformance cases, authorization level; `selfauth init --backend fastify`)
             gin              Gin (Go): a Go port of the core, 90/90 conformance cases on PostgreSQL and in-memory; API only; new projects (`selfauth init --backend gin`)
  Database   postgresql       PostgreSQL via Prisma 7 (migrations reviewed with `selfauth db plan`)
             mysql            MySQL 8 via Prisma 7 (derived from the PostgreSQL reference; 90/90 conformance cases, authorization level)
             mongodb          MongoDB 6+ via Mongoose 9 (its own store, not derived from SQL; authorization level; indexes via `selfauth db migrate`)
             sqlite           SQLite via Prisma 7: one file on one host, no server to run (derived from the PostgreSQL reference; 90/90 conformance cases, authorization level)
             memory           In-memory store for trying SelfAuth out (not for production)
  Frontend   none             API only
             vue              Vue 3 + Vite in client/ (reference frontend, browser-tested); `selfauth add-frontend` adds the auth module to an existing app
             react            React + Vite in client/ (reference frontend, browser-tested); `selfauth add-frontend` adds the auth module to an existing app
```

## `selfauth doctor`

```text
selfauth doctor [dir] [--json]
```

Checks the configuration and production readiness of a SelfAuth project. It does not change anything.

**Output** (a fresh project on the in-memory store):

```text
SelfAuth doctor → /home/you/my-app
  ⚠ in-memory store: data is lost on restart; use PostgreSQL, MySQL, SQLite or MongoDB in production
  ⚠ no email provider yet: implement createMailer() in src/email/mailer.ts before production
  • templates 0.15.0, spec 0.1, database memory

0 error(s), 2 warning(s).
```

Symbols: `✗` error (exit code non-zero), `⚠` warning, `•` note.

What it checks:

| Level | Check |
| --- | --- |
| Error | Node.js is older than 22.18 |
| Error | `selfauth.manifest.json` is missing or invalid |
| Error | The configuration is invalid |
| Error | `.env` is not ignored by git |
| Error | `.env` exists but `SELFAUTH_APP_BASE_URL` is missing |
| Warning | `registration.revealExistingEmail` or `signInAfterRegistration` is on |
| Warning | `emailVerification.mode` is not `required` |
| Warning | `sessions.cookie.secure` is `false`, or `sameSite` is `none` |
| Warning | The in-memory store is configured |
| Warning | `http.csrf.mode` is `token` but `SELFAUTH_CSRF_SECRET` is not set in `.env` |
| Warning | The email provider placeholder is still in place |
| Warning | `DATABASE_URL` is missing from `.env` (database projects) |
| Warning | A generated file was deleted |
| Note | Which generated files you changed; the template and spec versions; that `.env` does not exist yet |

Run it before every deployment. See [Going to production](/advanced/production).

## `selfauth validate`

```text
selfauth validate [dir] [--json]
```

Checks that the project is internally consistent: the configuration schema, which generated files you changed, and (for Prisma projects) that the Prisma schema matches the ownership manifest.

**Output:**

```text
SelfAuth validate → /home/you/my-app
  ✓ selfauth configuration is valid
  ✓ 31 generated file(s) unchanged
  • changed by you (kept, never overwritten): src/routes/index.ts, src/config/selfauth.config.ts

All checks passed.
```

A configuration problem names the key:

```text
  ✗ config authentication.password.minLength: Too small: expected number to be >=8
```

If Prisma is not installed yet, validate says so instead of guessing:

```text
  ✗ server: Prisma is not installed, so the database schema was not validated (run `npm install`)
```

Use it in CI: it exits non-zero when it finds a problem.
