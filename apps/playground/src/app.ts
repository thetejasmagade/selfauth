import type { SelfAuthConfig } from "@selfauth/spec";
import express, { type ErrorRequestHandler } from "express";
import type { Auth } from "./auth/index.ts";
import type { Logger } from "./auth/core/logger.ts";
import type { Env } from "./env.ts";
import { envelope, HttpError } from "./errors.ts";
import { assignRequestId, getRequestId } from "./request-id.ts";

export { getRequestId } from "./request-id.ts";

export interface AppOptions {
  env: Env;
  config: SelfAuthConfig;
  auth: Auth;
  logger?: Logger;
  /** Mount application routes before the 404 and error handlers. */
  mount?: (app: express.Express, auth: Auth) => void;
}

export function createApp({ env, config, auth, logger, mount }: AppOptions): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  // Forwarding headers are trusted only when configured (SEC-RATE-005).
  app.set("trust proxy", config.http.trustProxy);

  app.use(assignRequestId);
  if (logger) {
    app.use((req, res, next) => {
      const started = performance.now();
      res.on("finish", () => {
        // Path only: query strings and bodies are never logged (SEC-LOG-001).
        logger.log("info", "request", {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          requestId: getRequestId(res),
          ip: req.ip,
          durationMs: Math.round(performance.now() - started),
        });
      });
      next();
    });
  }
  app.use(express.json({ limit: config.http.bodyLimitBytes })); // SEC-HTTP-003
  app.use(auth.middleware);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use(config.http.basePath, auth.router);
  mount?.(app, auth);

  app.use((_req, _res, next) => {
    next(new HttpError(404, "NOT_FOUND", "Not found."));
  });
  app.use(auth.errorHandler);

  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const id = getRequestId(res);
    if (error instanceof HttpError) {
      res.status(error.status).json(envelope(error.code, error.message, id, error.details));
      return;
    }
    const type = (error as { type?: unknown } | null)?.type;
    if (type === "entity.too.large") {
      res.status(413).json(envelope("PAYLOAD_TOO_LARGE", "Request body too large.", id));
      return;
    }
    if (type === "entity.parse.failed") {
      res.status(400).json(envelope("VALIDATION_FAILED", "Malformed JSON body.", id));
      return;
    }
    // Never expose internals (SEC-LOG-002); details go to the server log only, redacted.
    logger?.log("error", "unhandled error", { requestId: id, error });
    if (!logger && env.nodeEnv !== "test") {
      // eslint-disable-next-line no-console
      console.error(`[${id}] unhandled error`, error);
    }
    res.status(500).json(envelope("INTERNAL_ERROR", "Internal server error.", id));
  };
  app.use(errorHandler);

  return app;
}
