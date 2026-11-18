---
"@selfauth/cli": minor
"selfauth": minor
"@selfauth/spec": minor
"@selfauth/migration": minor
"@selfauth/conformance": minor
---

MySQL is a supported database: `selfauth init --database mysql` (and `selfauth add --database mysql`)
for Express and Fastify, with the same 90 conformance cases passing on a real MySQL 8.

- Prisma 7 with the MariaDB driver adapter (`@prisma/adapter-mariadb`), so it works with MySQL 8 and
  MariaDB. `DATABASE_URL=mysql://user:password@host:3306/db`; create the empty database, then
  `selfauth db migrate`.
- Derived from the tested PostgreSQL reference at generation time (ADR 0025), like SQLite. Tables use
  the exact-byte `utf8mb4_bin` collation, because MySQL's default ignores case and accents and two
  different emails or rate-limit keys could collide. The rate-limit row lock is an upsert that
  changes nothing plus `SELECT ... FOR UPDATE`, which avoids the deadlock `INSERT IGNORE` causes.
- `@selfauth/migration`'s SQL safety analysis reads MySQL's backtick-quoted SQL and flags `MODIFY`,
  `CHANGE`, `DROP FOREIGN KEY`, `RENAME TABLE` and `DROP DATABASE`.
- Claimed at authorization level, not production, until its production profile has been reviewed.
