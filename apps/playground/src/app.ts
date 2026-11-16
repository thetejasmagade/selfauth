import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler, type RequestHandler, type Response } from "express";
import type { Env } from "./env.ts";
import { envelope, HttpError } from "./errors.ts";

/** Request body limit for all JSON endpoints (SEC-HTTP-003). */
export const BODY_LIMIT = "16kb";

/** Request ID set by the first middleware; appears in responses, logs and events (SEC-LOG-003). */
export function getRequestId(res: Response): string {
  return (res.locals as { requestId?: string }).requestId ?? "unknown";
}

const requestId: RequestHandler = (_req, res, next) => {
  const id = randomUUID();
  res.locals["requestId"] = id;
  res.setHeader("X-Request-Id", id);
  next();
};

export interface AppOptions {
  /** Mount additional routes before the 404 and error handlers. */
  mount?: (app: express.Express) => void;
}

/**
 * Builds the playground application. Authentication routes are added here in
 * Phase 3, feature by feature, against the requirement IDs in @selfauth/spec.
 */
export function createApp(env: Env, options: AppOptions = {}): express.Express {
  const app = express();
  app.disable("x-powered-by");
  // Forwarding headers are not trusted unless configured (SEC-RATE-005).
  app.set("trust proxy", false);

  app.use(requestId);
  app.use(express.json({ limit: BODY_LIMIT }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  options.mount?.(app);

  app.use((_req, _res, next) => {
    next(new HttpError(404, "NOT_FOUND", "Not found."));
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof HttpError) {
      res
        .status(error.status)
        .json(envelope(error.code, error.message, getRequestId(res), error.details));
      return;
    }
    const type = (error as { type?: unknown } | null)?.type;
    if (type === "entity.too.large") {
      res
        .status(413)
        .json(envelope("PAYLOAD_TOO_LARGE", "Request body too large.", getRequestId(res)));
      return;
    }
    if (type === "entity.parse.failed") {
      res
        .status(400)
        .json(envelope("VALIDATION_FAILED", "Malformed JSON body.", getRequestId(res)));
      return;
    }
    // Never expose internals (SEC-LOG-002). Log server-side with the request ID only.
    if (env.nodeEnv !== "test") {
      // eslint-disable-next-line no-console
      console.error(`[${getRequestId(res)}] unhandled error`, error);
    }
    res.status(500).json(envelope("INTERNAL_ERROR", "Internal server error.", getRequestId(res)));
  };
  app.use(errorHandler);

  return app;
}
