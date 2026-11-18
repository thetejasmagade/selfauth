---
"@selfauth/cli": minor
"selfauth": minor
"@selfauth/spec": minor
"@selfauth/migration": minor
"@selfauth/conformance": minor
---

SQLite is a supported database: `selfauth init --database sqlite` (and `selfauth add --database sqlite`)
for Express and Fastify, with the same 90 conformance cases passing.

- One file, no server to run. `DATABASE_URL=file:./app.db`; `selfauth db migrate` creates the file.
  Uses Prisma 7 with `better-sqlite3`.
- Derived from the tested PostgreSQL reference at generation time instead of copied (ADR 0025): the
  schema and the PostgreSQL-specific parts of the store are transformed, the migration is generated
  by Prisma, and CI runs the whole conformance suite, including the concurrent cases, against the
  derived code for both backends.
- Claimed at authorization level, not production: it is one file on one host, and the production
  profile expects a rate-limit store shared across instances.
- The configuration schema and the manifest accept `mysql` as a database name (not implemented
  yet; `createAuth()` and `selfauth upgrade` refuse it, as they do MongoDB).
- `selfauth db status` and `db plan` treat a SQLite file that does not exist yet as "nothing
  applied" instead of failing.
