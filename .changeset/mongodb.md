---
"@selfauth/cli": minor
"selfauth": minor
"@selfauth/spec": minor
"@selfauth/migration": minor
"@selfauth/conformance": minor
---

MongoDB is a supported database: `selfauth init --database mongodb` (and `selfauth add --database
mongodb`) for Express and Fastify, through Mongoose 9.

- Its own store, not derived from SQL (ADR 0026). No transactions: the credential and the role links
  are embedded in the user document so creating a user is one atomic write; tokens, sessions and
  roles use conditional updates; rate limits use compare-and-swap. It works on a standalone server
  and on a replica set. Every lookup key is checked to be a string, so a request cannot smuggle a
  query operator into a filter.
- Indexes, not migrations: `selfauth db migrate` (or `npm run db:migrate`) creates the missing indexes
  and never drops one; `selfauth db plan` lists them. The unique email index is what keeps accounts
  unique, so the server refuses to start without the indexes.
- Claimed at authorization level, not production, until its production profile has been reviewed.
- The conformance run uses a real MongoDB in CI (`scripts/dialect-conformance.mjs mongodb`); the test
  helpers now sit behind `test/database.ts` so another database replaces one file.
