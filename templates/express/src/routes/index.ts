import express from "express";
import type { Auth } from "../auth/index.ts";
import type { Database } from "../db/store.ts";

/**
 * Your application's routes. Examples of the three guard styles:
 * - `auth.requireAuth`: any signed-in user;
 * - `auth.requirePermission("x.y")`: a permission from selfauth.config.ts;
 * - `auth.protectedRoutes()`: a router that denies every route lacking a guard.
 * Route guards run on the server for every request (AUTHZ-CORE-002).
 *
 * `db` is the database client SelfAuth uses, for your own tables. It is undefined while the app
 * runs on the in-memory store (no DATABASE_URL set).
 */
export function mountRoutes(app: express.Express, auth: Auth, db: Database | undefined): void {
  const api = express.Router();
  api.get("/hello", auth.requireAuth, (_req, res) => {
    res.json({ hello: auth.context(res)!.user.email, database: db ? "connected" : "in-memory" });
  });
  app.use("/api", api);
}
