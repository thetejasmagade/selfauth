import type { FastifyInstance } from "fastify";
import type { Auth } from "../auth/index.ts";

/**
 * Your application's routes. Examples of the three guard styles:
 * - `auth.requireAuth`: any signed-in user;
 * - `auth.requirePermission("x.y")`: a permission from selfauth.config.ts;
 * - `auth.protectedRoutes(app, prefix)`: routes that are denied unless a guard allows them.
 * Route guards run on the server for every request (AUTHZ-CORE-002).
 */
export function mountRoutes(app: FastifyInstance, auth: Auth): void {
  app.get("/api/hello", { preHandler: auth.requireAuth }, async (req) => {
    return { hello: auth.context(req)!.user.email };
  });
}
