---
"@selfauth/cli": minor
---

Your routes now get the database. `mountRoutes(app, auth, db)` (Express and Fastify) receives the Prisma client, or the Mongoose connection on MongoDB, that SelfAuth already uses, so your own tables need no second client. Gin's `routes.Register(r, a, db)` receives a `store.DB` with `SQL` (`*sql.DB` on PostgreSQL, MySQL and SQLite) or `Mongo` (`*mongo.Database`). `db` is undefined (Gin: empty) on the in-memory store. The example `/api/hello` route also says whether a database is connected.

Upgrading: if you edited `src/routes/index.ts` (Gin: `internal/routes/routes.go`), `selfauth upgrade` keeps your file and writes a `.selfauth-new` proposal; add the `db` parameter to your `mountRoutes` / `Register` signature so it matches the updated `server.ts` / `cmd/server/main.go`.
