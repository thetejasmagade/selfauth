---
"@selfauth/cli": minor
---

`selfauth init --backend gin` now works with every database: PostgreSQL, MySQL, SQLite and MongoDB as well as the in-memory store. MySQL and SQLite share a `database/sql` store (the schema is the one derived from the PostgreSQL reference, written to `db/migrations`); MongoDB has its own store with the same collections and documents as the TypeScript one and creates indexes instead of migrations. Only the code of the database you choose is generated. All 90 conformance cases pass on each (MySQL and SQLite verified locally, MongoDB in CI), and `selfauth db`, `doctor`, `validate`, `diff` and `upgrade` work with them.
