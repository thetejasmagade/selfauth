---
title: What each database changes
description: How the generated project differs for PostgreSQL, MySQL, SQLite, MongoDB and the in-memory store. Files, environment variables, scripts and migration commands for each.
keywords: [postgresql, mysql, sqlite, mongodb, memory, prisma, mongoose, pgx, DATABASE_URL, migrations]
---

# What each database changes

The authentication rules, routes and configuration are the same for every database. Only the **store** (the code that saves data), the **schema files** and a few commands change.

## At a glance

| Database | Library | `DATABASE_URL` example | Schema files | Apply schema | Server to run? |
| --- | --- | --- | --- | --- | --- |
| PostgreSQL | Prisma 7 (Gin: pgx) | `postgresql://user:password@localhost:5432/app` | `prisma/` (Gin: `db/migrations/`) | `npm run db:migrate` (Gin: `go run ./cmd/migrate up`) | Yes |
| MySQL 8 / MariaDB | Prisma 7 | `mysql://user:password@localhost:3306/app` | `prisma/` | `npm run db:migrate` | Yes |
| SQLite | Prisma 7 | `file:./app.db` | `prisma/` | `npm run db:migrate` | No |
| MongoDB 6+ | Mongoose 9 | `mongodb://localhost:27017/app` | none | `npm run db:migrate` (creates indexes) | Yes |
| In-memory | none | not set | none | none | No |

`DATABASE_URL` lives in `.env` (`server/.env` for a full-stack project). If it is unset in development the app uses memory. **In production the app refuses to start without it.**

## Files that appear or disappear

| File or folder | PostgreSQL / MySQL / SQLite | MongoDB | Memory |
| --- | :---: | :---: | :---: |
| `prisma/schema.prisma`, `prisma/migrations/` | yes | no | no |
| `prisma.config.ts` | yes | no | no |
| `src/auth/stores/prisma.ts` | yes | no | no |
| `src/auth/stores/mongoose.ts` | no | yes | no |
| `src/scripts/migrate.ts` | no | yes | no |
| `src/scripts/seed.ts`, `create-admin.ts` | yes | yes | no |
| `src/auth/stores/memory.ts` | yes | yes | yes |

## The commands you will use

```bash
npx selfauth db plan        # review pending migrations for dangerous changes
npx selfauth db migrate     # apply them
npm run db:seed             # write roles and permissions
npm run db:create-admin you@example.com
```

[`selfauth db`](/cli/db) explains each. Migrations are **never** run when the server starts.

## PostgreSQL

The reference. Several app servers can share one database: the rate-limit counters are row-locked and shared.

```bash
createdb app                                   # or use your hosting provider's console
cp .env.example .env                           # set DATABASE_URL
npx selfauth db migrate
npm run db:seed
```

Special characters in the password must be URL-encoded (`@` becomes `%40`). Managed databases that use a transaction-mode pooler (for example Supabase on port 6543) need a **direct** or **session-mode** connection for migrations. See [Troubleshooting](/troubleshooting#database-url-is-not-set).

## MySQL

Tables use `utf8mb4_bin` collation so that different emails never compare equal. Create the empty database first, then run `selfauth db migrate`. Claimed at *authorization level* until its production profile is reviewed.

## SQLite

One file, one host. `selfauth db migrate` creates the file next to `prisma.config.ts`. A relative `file:` URL is resolved from the folder you start the server in, so run the server from the project folder (the npm scripts do) or use an absolute path. Do not use SQLite with several app instances.

## MongoDB

SelfAuth's own Mongoose store, not derived from SQL. The six collections are `auth_users`, `auth_sessions`, `auth_one_time_tokens`, `auth_roles`, `auth_security_events` and `auth_rate_limits`.

There are **no migrations**, only indexes. `npm run db:migrate` creates the missing ones and never drops one. The unique index on the normalized email is what keeps accounts unique, so the server refuses to start without the indexes. Claimed at *authorization level* until its production profile is reviewed.

## In-memory

For a first look and for tests. Everything is lost on restart, and production refuses it. `selfauth doctor` warns about it.

## Tables SelfAuth owns

All names start with `auth_`, so they cannot collide with yours: `auth_users`, `auth_credentials`, `auth_sessions`, `auth_roles`, `auth_permissions`, `auth_role_permissions`, `auth_user_roles`, `auth_email_verification_tokens`, `auth_password_reset_tokens`, `auth_security_events`, `auth_rate_limits`. Passwords are stored as Argon2id hashes in `auth_credentials`, apart from the user row. Sessions store only a SHA-256 hash of the token.

## Next

- [Add an API route](/build/add-api-route)
- [Change the database](/build/database-changes)
