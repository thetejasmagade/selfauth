---
"@selfauth/cli": minor
---

Gin projects get the same migration safety review as Prisma ones: `selfauth db plan` and `selfauth db migrate` now read the SQL in `db/migrations/`, flag changes that lose data or touch SelfAuth's tables, and `migrate` refuses them without `--approve-destructive`. Also for Gin: a handler that calls `c.Error(err)` now answers a 500 in the standard error format (with the error in the server log) instead of an empty 200; the server binds its port before printing "Listening", and a busy port is one clear error; generated Go files are gofmt-clean whatever the module name sorts like; and in a project with a frontend, `npm run db:seed`, `db:create-admin`, `db:migrate` and `db:status` load `server/.env` like `npm run dev` does. Fastify reports a failed start in one line (for example a busy port) instead of a stack trace.
