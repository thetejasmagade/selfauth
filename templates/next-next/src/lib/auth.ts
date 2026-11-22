import { createAuth, type Auth } from "../auth/index.ts";
import type { RouteHandler } from "../auth/next/index.ts";
import { envelope } from "../http/errors.ts";
import { createLogger } from "../auth/core/logger.ts";
import { localDevelopmentConfig } from "../config/dev-config.ts";
import { loadEnv } from "../config/env.ts";
import { config as baseConfig } from "../config/selfauth.config.ts";
import { createStores, type Database } from "../db/store.ts";
import { createMailer } from "../email/mailer.ts";

export interface SelfAuth {
  auth: Auth;
  /** The database client for your own tables; undefined on the in-memory store. */
  db: Database | undefined;
}

/**
 * Next.js loads modules more than once (hot reload in development, one copy per route in a
 * build), so the instance lives on `globalThis`: one set of stores, one rate limiter, one policy
 * registry. Every route handler calls this; the first call builds it.
 */
const KEY = Symbol.for("selfauth.instance");
type Holder = { [KEY]?: Promise<SelfAuth> };

export function getSelfAuth(): Promise<SelfAuth> {
  const holder = globalThis as Holder;
  holder[KEY] ??= create().catch((error: unknown) => {
    delete holder[KEY]; // a fixed environment is picked up by the next request
    throw error;
  });
  return holder[KEY];
}

async function create(): Promise<SelfAuth> {
  const env = loadEnv();
  // Plain-http local development cannot use Secure / __Host- cookies.
  const config = env.nodeEnv === "production" ? baseConfig : localDevelopmentConfig(baseConfig);
  const mailer = createMailer(env);
  const { store, rateLimitStore, db } = await createStores(config);
  const auth = createAuth({
    config,
    store,
    mailer,
    appBaseUrl: env.appBaseUrl,
    nodeEnv: env.nodeEnv,
    logger: createLogger(),
    ...(rateLimitStore ? { rateLimitStore } : {}),
    ...(env.csrfSecret ? { csrfSecret: env.csrfSecret } : {}),
    ...(env.csrfSecretPrevious ? { csrfSecretPrevious: env.csrfSecretPrevious } : {}),
  });
  return { auth, db };
}

/**
 * Builds a route handler from the SelfAuth instance. The instance is created on the first request
 * (not when the module loads, so `next build` needs no environment variables), and `build` runs
 * once; guards such as `auth.requirePermission("x")` are validated then (AUTHZ-PERM-004).
 *
 *   export const GET = withAuth((auth) => auth.protect(auth.requirePermission("x.y"), handler));
 *
 * `db` is your database client for your own tables (undefined on the in-memory store).
 */
export function withAuth(
  build: (auth: Auth, db: Database | undefined) => RouteHandler,
): RouteHandler {
  let built: RouteHandler | undefined;
  return async (req, ctx) => {
    try {
      if (!built) {
        const { auth, db } = await getSelfAuth();
        built = build(auth, db);
      }
    } catch (error) {
      // The server could not start (a bad environment variable, an unreachable database).
      // eslint-disable-next-line no-console
      console.error("SelfAuth could not start:", error);
      return Response.json(
        envelope("INTERNAL_ERROR", "Internal server error.", crypto.randomUUID()),
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    return built(req, ctx);
  };
}
