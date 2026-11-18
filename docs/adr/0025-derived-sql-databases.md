# 0025: SQLite (and MySQL) are derived from the PostgreSQL reference

- Status: accepted
- Date: 2026-11-18

## Context

Users asked for SQLite, MySQL and MongoDB. The tested PostgreSQL implementation (Prisma schema,
migration, `PrismaAuthStore`, `PrismaRateLimitStore`) passes all 90 conformance cases on both
backends. Copying it into a reference app per database and backend would mean six more apps that
must stay in step with the core, and ADR 0018 says every template is a byte-for-byte copy of tested
code.

## Decision

- **One reference, transformed at generation time.** PostgreSQL stays the single tested source.
  `packages/cli/src/dialect.ts` derives the other SQL databases from it: the schema (provider,
  native types such as `@db.Uuid` dropped, the one column SQLite cannot express removed), and the
  parts of the store that are PostgreSQL SQL. Those parts sit between `// <dialect:...>` markers in
  `src/auth/stores/prisma.ts`, so a transform replaces a whole block instead of patching text.
  A marker or pattern that is not found throws, the same rule as `example.ts`.
- **The suite runs on the derived code.** `scripts/dialect-conformance.mjs <db> <app>` copies a
  reference app, applies the same transforms `selfauth init` applies, generates the migration with
  Prisma, swaps in the database's test helpers and runs every conformance case, including the
  concurrent ones. CI runs it for each derived database and both backends.
- **The migration is generated, not hand-written.** `scripts/sync-dialects.mjs` runs
  `prisma migrate diff` on the derived schema and commits the SQL under
  `packages/cli/template-variants/<db>/prisma/migrations/`; `pnpm templates:check` fails when it is
  stale.
- **SQLite specifics.** The adapter is `@prisma/adapter-better-sqlite3`. SQLite has no row locks,
  so the rate-limit update begins with a write (`INSERT OR IGNORE`), which takes the database's
  write lock until commit, and concurrent updates of one key serialize. Prisma's SQLite connector
  has no `skipDuplicates`, so role links use upserts. `auth_security_events.seq` (an insertion-order
  aid used only by tests) is dropped because SQLite allows autoincrement on the primary key only;
  the test helper reads `rowid` instead. Write-ahead logging is switched on at start-up.
- **Claimed level.** SQLite is claimed at authorization level, not production: it is one file on
  one host, and the production profile expects a rate-limit store shared across instances
  (SEC-RATE-006).
- **MongoDB is different.** It has no SQL schema to derive from; it gets its own Mongoose store and
  its own conformance run (a later change).

## Consequences

- A change to the PostgreSQL store that falls outside the markers is inherited by every database
  automatically; a change inside a marker needs the dialect text updated, and the dialect
  conformance run in CI fails until it is.
- The derived databases are exactly as trustworthy as the conformance suite is. The suite caught
  three database-specific problems while this was built (`seq`, a JSON default, `skipDuplicates`).
- `selfauth db migrate` for SQLite creates the database file; before that, `db status` and
  `db plan` treat a missing file as "nothing applied yet".
