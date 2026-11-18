# 0026: MongoDB has its own Mongoose store, without transactions

- Status: accepted
- Date: 2026-11-18

## Context

SQLite and MySQL are derived from the PostgreSQL reference (ADR 0025). MongoDB has no SQL schema to
derive from, and the contract still requires the same guarantees: user creation all or nothing
(AUTHN-REG-003), one-time tokens used once under concurrency (AUTHN-RESET-009), rate-limit counters
that cannot be raced (SEC-RATE-001), unique emails (DATA-MODEL-001).

## Decision

- **A separate store, tested by the same suite.** `template-variants/mongodb/src/auth/stores/mongoose.ts`
  implements `AuthStore` and the rate-limit store; the db wiring and the migrate, seed and
  create-admin scripts sit next to it. They are registry entries for the Express and Fastify
  stacks. `scripts/dialect-conformance.mjs mongodb <app>` copies a reference app, swaps those files
  in, replaces the PostgreSQL test database (`test/database.ts`) with a MongoDB one, and runs every
  conformance case against a real MongoDB. CI does this for both backends.
- **No transactions.** Transactions need a replica set, and a standalone server is the common local
  and small-deployment setup. Each guarantee comes from one atomic write instead:
  - the credential and the role links are embedded in the user document, so creating a user is one
    insert; the credential is excluded from every read except `getPasswordHash`;
  - token consumption, session revocation and role grants are conditional updates (`updateOne`
    with the condition in the filter; `$push` guarded by `roles.name: { $ne }`);
  - a rate-limit update is compare-and-swap on a `v` version number, retried when another request
    won; the first write is a unique-keyed insert;
  - the password hash is replaced by a conditional update of the embedded credential (a second
    conditional update creates it when there is none). A first version used an aggregation-pipeline
    update; it failed against a real MongoDB (a string starting with `$`, such as an Argon2 hash, is
    a field path in a pipeline, and Mongoose guards pipeline updates behind an option), and plain
    updates avoid the whole class.
- **Indexes are the migration.** There is no SQL, so `db:migrate` creates the missing indexes
  (never drops one) and `--plan` lists them. The unique partial index on `emailNormalized` is what
  makes concurrent registrations of one address produce one account, so start-up refuses to run
  when any index is missing instead of running without it.
- **Lookup keys are strings.** Every key that reaches a query is checked to be a string. In MongoDB
  an object in a filter is an operator (`{ "$ne": null }`), which is how NoSQL injection works.
- **Claimed level.** Authorization, not production, until the production profile (write concerns,
  replica-set behaviour, index builds on large collections) is reviewed.

## Consequences

- The store is new code, not a transform of tested code. The conformance suite is its only
  runtime evidence, so it must pass on a real MongoDB in CI before the claim stands.
- Two things the SQL databases get from the database, this store gets from its own code: uniqueness
  of emails (index) and atomic multi-record creation (embedding). Both are covered by cases
  (`CT-REG-006` concurrent registration, `CT-REG-001`...), but a future change that splits the
  credential out of the user document would need a transaction or a compensating step.
- `selfauth db` for MongoDB runs the project's own `src/scripts/migrate.ts`; `rollback` and
  `validate` explain that there is nothing to roll back.
