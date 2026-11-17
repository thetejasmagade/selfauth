import express from "express";
import type { Auth } from "../auth/index.ts";

/**
 * Your application's routes. Examples of the three guard styles:
 * - `auth.requireAuth`: any signed-in user;
 * - `auth.requirePermission("x.y")`: a permission from selfauth.config.ts;
 * - `auth.protectedRoutes()`: a router that denies every route lacking a guard.
 * Route guards run on the server for every request (AUTHZ-CORE-002).
 */
export function mountRoutes(app: express.Express, auth: Auth): void {
  const api = express.Router();
  api.get("/hello", auth.requireAuth, (_req, res) => {
    res.json({ hello: auth.context(res)!.user.email });
  });
  app.use("/api", api);
}
