import type { FastifyInstance } from "fastify";
import type { Auth } from "../auth/index.ts";
import type { Database } from "../db/store.ts";

/**
 * Your application's routes. Examples of the three guard styles:
 * - `auth.requireAuth`: any signed-in user;
 * - `auth.requirePermission("x.y")`: a permission from selfauth.config.ts;
 * - `auth.protectedRoutes(app, prefix)`: routes that are denied unless a guard allows them.
 * Route guards run on the server for every request (AUTHZ-CORE-002).
 *
 * `db` is the database client SelfAuth uses, for your own tables. It is undefined while the app
 * runs on the in-memory store (no DATABASE_URL set).
 */
export function mountRoutes(app: FastifyInstance, auth: Auth, db: Database | undefined): void {
  app.get("/api/hello", { preHandler: auth.requireAuth }, async (req) => {
    return { hello: auth.context(req)!.user.email, database: db ? "connected" : "in-memory" };
  });
}
