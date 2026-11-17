import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { SelfAuthConfig } from "./auth/types.ts";
import type { Auth } from "./auth/index.ts";
import type { Logger } from "./auth/core/logger.ts";
import type { Env } from "./config/env.ts";
import { envelope, HttpError } from "./http/errors.ts";
import { getRequestId } from "./http/request-id.ts";

export { getRequestId } from "./http/request-id.ts";

export interface AppOptions {
  env: Env;
  config: SelfAuthConfig;
  auth: Auth;
  logger?: Logger;
  /** Register application routes before the 404 and error handlers are set. */
  mount?: (app: FastifyInstance, auth: Auth) => void;
}

/** `http.trustProxy` is false, a hop count or a list of proxy CIDRs; Fastify takes a function for a count. */
function trustProxy(
  setting: SelfAuthConfig["http"]["trustProxy"],
): NonNullable<FastifyServerOptions["trustProxy"]> {
  return typeof setting === "number" ? (_address, hop) => hop < setting : setting;
}

export function createApp({ env, config, auth, logger, mount }: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: config.http.bodyLimitBytes, // SEC-HTTP-003
    // Forwarding headers are trusted only when configured (SEC-RATE-005).
    trustProxy: trustProxy(config.http.trustProxy),
    // Always generated here, never read from a header (SEC-LOG-003).
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    routerOptions: { ignoreTrailingSlash: true },
  });

  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Request-Id", getRequestId(req));
  });
  if (logger) {
    app.addHook("onResponse", async (req, reply) => {
      // Path only: query strings and bodies are never logged (SEC-LOG-001).
      logger.log("info", "request", {
        method: req.method,
        path: req.url.split("?")[0],
        status: reply.statusCode,
        requestId: getRequestId(req),
        ip: req.ip,
        durationMs: Math.round(reply.elapsedTime),
      });
    });
  }

  // JSON only; an empty body is fine (logout, for example). A malformed one is a 400.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, text, done) => {
    if (text === "") return done(null, undefined);
    try {
      done(null, JSON.parse(text as string));
    } catch {
      done(new HttpError(400, "VALIDATION_FAILED", "Malformed JSON body."));
    }
  });

  auth.install(app);

  app.get("/health", async () => ({ status: "ok" }));
  mount?.(app, auth);

  app.setNotFoundHandler(async (_req, reply) => {
    return reply.code(404).send(envelope("NOT_FOUND", "Not found.", getRequestId(_req)));
  });

  app.setErrorHandler(async (error, req, reply) => {
    if (auth.handleError(error, req, reply)) return reply;
    const id = getRequestId(req);
    if (error instanceof HttpError) {
      return reply.code(error.status).send(envelope(error.code, error.message, id, error.details));
    }
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.code(413).send(envelope("PAYLOAD_TOO_LARGE", "Request body too large.", id));
    }
    if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      return reply
        .code(400)
        .send(envelope("VALIDATION_FAILED", "Content-Type must be application/json.", id));
    }
    // Never expose internals (SEC-LOG-002); details go to the server log only, redacted.
    logger?.log("error", "unhandled error", { requestId: id, error });
    if (!logger && env.nodeEnv !== "test") {
      // eslint-disable-next-line no-console
      console.error(`[${id}] unhandled error`, error);
    }
    return reply.code(500).send(envelope("INTERNAL_ERROR", "Internal server error.", id));
  });

  return app;
}
