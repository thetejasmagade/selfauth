import { withAuth } from "../../../lib/auth.ts";

/**
 * Your application's routes live next to this file as ordinary Next.js route handlers
 * (`src/app/api/<name>/route.ts`). Build every handler with `withAuth`, and pick the guard that
 * says who may call it:
 * - `auth.protect(auth.requireAuth, handler)`: any signed-in user;
 * - `auth.protect(auth.requirePermission("x.y"), handler)`: a permission from selfauth.config.ts;
 * - `auth.route(handler)`: a public route that still gets the session, the CSRF check and the
 *   error envelope.
 * A protected route no guard allowed is refused (deny by default). Guards run on the server for
 * every request (AUTHZ-CORE-002).
 *
 * `db` is the database client SelfAuth uses, for your own tables. It is undefined while the app
 * runs on the in-memory store (no DATABASE_URL set).
 */
export const GET = withAuth((auth, db) =>
  auth.protect(auth.requireAuth, (_req, call) =>
    Response.json({ hello: call.auth.user.email, database: db ? "connected" : "in-memory" }),
  ),
);
export const OPTIONS = withAuth((auth) => auth.preflight);
