---
title: What each database changes
description: How the generated project differs for PostgreSQL, MySQL, SQLite, MongoDB and the in-memory store. Files, environment variables, scripts and migration commands for each.
keywords: [postgresql, mysql, sqlite, mongodb, memory, prisma, mongoose, pgx, DATABASE_URL, migrations]
---

# What each database changes

Every backend works with every database, and the authentication rules, routes and configuration are the same whichever database you pick. What changes is the store (the code that saves data), the schema files, and a few commands.

## At a glance

| Database | Library | `DATABASE_URL` example | Schema files | Apply schema | Server to run? |
| --- | --- | --- | --- | --- | --- |
| PostgreSQL | Prisma 7 (Gin: pgx) | `postgresql://user:password@localhost:5432/app` | `prisma/` (Gin: `db/migrations/`) | `npm run db:migrate` (Gin: `go run ./cmd/migrate up`) | Yes |
| MySQL 8 / MariaDB | Prisma 7 (Gin: database/sql) | `mysql://user:password@localhost:3306/app` | `prisma/` (Gin: `db/migrations/`) | `npm run db:migrate` (Gin: `go run ./cmd/migrate up`) | Yes |
| SQLite | Prisma 7 (Gin: database/sql) | `file:./app.db` | `prisma/` (Gin: `db/migrations/`) | `npm run db:migrate` (Gin: `go run ./cmd/migrate up`) | No |
| MongoDB 6+ | Mongoose 9 (Gin: the official driver) | `mongodb://localhost:27017/app` | none | `npm run db:migrate` (Gin: `go run ./cmd/migrate up`), which creates indexes | Yes |
| In-memory | none | not set | none | none | No |

`DATABASE_URL` goes in `.env` (`server/.env` in a full-stack project). If it's unset in development, the app uses memory. In production it won't start without it.

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

[`selfauth db`](/cli/db) explains each one. Migrations never run when the server starts.

## PostgreSQL

This is the reference setup. Several app servers can share one database, because the rate limit counters are row-locked and shared.

```bash
createdb app                                   # or use your hosting provider's console
cp .env.example .env                           # set DATABASE_URL
npx selfauth db migrate
npm run db:seed
```

URL-encode special characters in the password (`@` becomes `%40`). If your host puts a transaction-mode pooler in front of the database (Supabase on port 6543, for example), migrations need a direct or session-mode connection. See [Troubleshooting](/troubleshooting#database-url-is-not-set).

## MySQL

Tables use the `utf8mb4_bin` collation so two different emails never compare equal. Create the empty database first, then run `selfauth db migrate`. It's claimed at authorization level until its production profile has been reviewed.

## SQLite

One file on one host. `selfauth db migrate` creates the file next to `prisma.config.ts`. A relative `file:` URL is resolved from the folder you start the server in, so start it from the project folder (the npm scripts do) or use an absolute path. Don't run SQLite with several app instances.

## MongoDB

This is SelfAuth's own Mongoose store, not something derived from the SQL schema. It uses six collections: `auth_users`, `auth_sessions`, `auth_one_time_tokens`, `auth_roles`, `auth_security_events` and `auth_rate_limits`.

There are no migrations, only indexes. `npm run db:migrate` creates any that are missing and never drops one. The unique index on the normalized email is what keeps accounts unique, so the server won't start without the indexes. Claimed at authorization level until its production profile has been reviewed.

## In-memory

Handy for a first look and for tests. Everything is lost on restart, production refuses it, and `selfauth doctor` warns about it.

## Tables SelfAuth owns

Every name starts with `auth_`, so none can collide with yours. They are `auth_users`, `auth_credentials`, `auth_sessions`, `auth_roles`, `auth_permissions`, `auth_role_permissions`, `auth_user_roles`, `auth_email_verification_tokens`, `auth_password_reset_tokens`, `auth_security_events` and `auth_rate_limits`. Passwords are stored as Argon2id hashes in `auth_credentials`, separate from the user row, and sessions keep only a SHA-256 hash of the token.
