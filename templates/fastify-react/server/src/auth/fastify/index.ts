import type { ErrorCode, SelfAuthConfig } from "../types.ts";
import { parseCookie, stringifySetCookie } from "cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from "fastify";
import { knownPermissions, type PolicyRegistry } from "../core/authorization.ts";
import type { Clock } from "../core/clock.ts";
import { hmacSha256, safeEqual } from "../core/crypto.ts";
import { AuthError, fail, MESSAGES } from "../core/errors.ts";
import type { AuthContext, AuthService, IssuedSession, RequestContext } from "../core/service.ts";

/**
 * HTTP status per error code (non-normative binding in specs/ERRORS.md).
 * Copied so the app has no runtime SelfAuth dependency; a test checks parity.
 */
export const HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  PASSWORD_POLICY_VIOLATION: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  EMAIL_NOT_VERIFIED: 403,
  ACCOUNT_UNAVAILABLE: 403,
  FORBIDDEN: 403,
  REAUTHENTICATION_REQUIRED: 403,
  CSRF_FAILED: 403,
  NOT_FOUND: 404,
  TOKEN_INVALID: 400,
  EMAIL_TAKEN: 409,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
};

declare module "fastify" {
  interface FastifyRequest {
    /** The validated session context, or null (set by SelfAuth's session hook). */
    selfauth: AuthContext | null;
    /** The session token the browser presented, if any. */
    selfauthToken: string | undefined;
    /** Set by a guard that allowed the request (AUTHZ-CORE-001). */
    selfauthAuthorized: boolean;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface FastifyAuthOptions {
  config: SelfAuthConfig;
  service: AuthService;
  policies: PolicyRegistry;
  appBaseUrl: URL;
  clock: Clock;
  /** Required when http.csrf.mode is "token" (SEC-CSRF-004); ≥ 32 bytes. */
  csrfSecret?: Buffer | undefined;
  /** Previous secret accepted during rotation (SEC-SECRET-004). */
  csrfSecretPrevious?: Buffer | undefined;
  requestId: (req: FastifyRequest) => string;
}

/** A guard runs before the route handler and throws an AuthError to refuse the request. */
export type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface FastifyAuth {
  /**
   * Call once, before your own routes: adds the CORS, session and CSRF hooks and the
   * authentication routes at `config.http.basePath`.
   */
  install(app: FastifyInstance): void;
  /**
   * Maps an AuthError to the spec error envelope. Returns false for any other error, so your
   * own error handler can deal with it.
   */
  handleError(error: unknown, req: FastifyRequest, reply: FastifyReply): boolean;
  /** The validated session context, or null. */
  context(req: FastifyRequest): AuthContext | null;
  requireAuth: Guard;
  /** Throws at definition time for undefined permissions (AUTHZ-PERM-004). */
  requirePermission(permission: string): Guard;
  authorizeResource(
    permission: string,
    resource: (req: FastifyRequest) => { type: string; id: string },
  ): Guard;
  /**
   * Routes registered through this are denied unless a guard explicitly allows them
   * (AUTHZ-CORE-001). Paths are relative to `prefix`.
   */
  protectedRoutes(app: FastifyInstance, prefix?: string): ProtectedRoutes;
}

type Method = "get" | "post" | "put" | "patch" | "delete";
export type ProtectedRoutes = Record<
  Method,
  (path: string, ...rest: [...guards: Guard[], handler: RouteHandlerMethod]) => ProtectedRoutes
>;

export function requestContext(
  req: FastifyRequest,
  requestId: (req: FastifyRequest) => string,
): RequestContext {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
    requestId: requestId(req),
  };
}

export function createFastifyAuth(options: FastifyAuthOptions): FastifyAuth {
  const { config, service, policies } = options;
  const cookieConfig = config.authentication.sessions.cookie;
  const csrfConfig = config.http.csrf;
  const trustedOrigins = new Set([...config.http.trustedOrigins, options.appBaseUrl.origin]);
  const known = knownPermissions(config);

  if (csrfConfig.mode === "token" && (!options.csrfSecret || options.csrfSecret.length < 32)) {
    throw new Error(
      "http.csrf.mode 'token' requires a CSRF secret of at least 32 bytes (SEC-SECRET-003)",
    );
  }

  const ctx = (req: FastifyRequest) => requestContext(req, options.requestId);
  const context = (req: FastifyRequest): AuthContext | null => req.selfauth ?? null;
  const body = (req: FastifyRequest): Record<string, unknown> =>
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};
  const header = (req: FastifyRequest, name: string): string | undefined => {
    const value = req.headers[name];
    return typeof value === "string" ? value : undefined;
  };
  const param = (req: FastifyRequest, name: string): string =>
    (req.params as Record<string, string>)[name] as string;

  // ── cookies ──
  const setSessionCookie = (reply: FastifyReply, issued: IssuedSession) => {
    const maxAge = Math.max(
      0,
      Math.floor(
        (issued.session.absoluteExpiresAt.getTime() - options.clock.now().getTime()) / 1000,
      ),
    );
    reply.header(
      "Set-Cookie",
      stringifySetCookie({
        name: cookieConfig.name,
        value: issued.token,
        httpOnly: true,
        secure: cookieConfig.secure,
        sameSite: cookieConfig.sameSite,
        path: "/",
        // Never longer than the absolute session lifetime (SEC-COOKIE-004).
        maxAge: Math.min(maxAge, config.authentication.sessions.absoluteTimeoutMinutes * 60),
      }),
    );
  };
  const clearSessionCookie = (reply: FastifyReply) => {
    reply.header(
      "Set-Cookie",
      stringifySetCookie({
        name: cookieConfig.name,
        value: "",
        httpOnly: true,
        secure: cookieConfig.secure,
        sameSite: cookieConfig.sameSite,
        path: "/",
        maxAge: 0,
        expires: new Date(0),
      }),
    );
  };

  // ── CSRF tokens bound to the session (token mode) ──
  const csrfTokenFor = (sessionId: string, key = options.csrfSecret) =>
    key ? hmacSha256(key, `csrf:${sessionId}`) : undefined;
  const csrfField = (sessionId: string) =>
    csrfConfig.mode === "token" ? { csrfToken: csrfTokenFor(sessionId) } : {};
  const validCsrfToken = (sessionId: string, presented: string | undefined) => {
    if (!presented) return false;
    return [options.csrfSecret, options.csrfSecretPrevious].some((key) => {
      const expected = csrfTokenFor(sessionId, key);
      return expected !== undefined && safeEqual(expected, presented);
    });
  };

  // ── hooks (run for every request, including unknown routes) ──
  const cors = async (req: FastifyRequest, reply: FastifyReply) => {
    const origin = header(req, "origin");
    if (origin && trustedOrigins.has(origin)) {
      // Explicit allow-list only, never reflection (SEC-CORS-001).
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
    }
    reply.header("Vary", "Origin");
    if (req.method === "OPTIONS" && header(req, "access-control-request-method")) {
      if (origin && trustedOrigins.has(origin)) {
        reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE");
        reply.header("Access-Control-Allow-Headers", `Content-Type, ${csrfConfig.headerName}`);
        reply.header("Access-Control-Max-Age", "600");
      }
      return reply.code(204).send();
    }
    return undefined;
  };

  const session = async (req: FastifyRequest) => {
    const token = parseCookie(header(req, "cookie") ?? "")[cookieConfig.name];
    req.selfauthToken = token;
    req.selfauth = await service.authenticate(token);
  };

  const csrf = async (req: FastifyRequest) => {
    if (SAFE_METHODS.has(req.method)) return; // SEC-CSRF-002: safe methods never change state
    const fetchSite = header(req, "sec-fetch-site");
    const origin = header(req, "origin");
    const presented = header(req, csrfConfig.headerName.toLowerCase());
    const auth = context(req);

    let ok = fetchSite !== "cross-site" && (origin === undefined || trustedOrigins.has(origin));
    if (ok && csrfConfig.mode === "header") {
      ok = typeof presented === "string" && presented.length > 0;
    } else if (ok && auth) {
      ok = validCsrfToken(auth.session.id, presented);
    } else if (ok) {
      // Token mode without a session (login, registration): require browser origin proof.
      ok = (origin !== undefined && trustedOrigins.has(origin)) || fetchSite === "same-origin";
    }
    if (ok) return;
    await service.csrfRejected(ctx(req));
    throw new AuthError("CSRF_FAILED", "Request origin could not be verified.");
  };

  // ── guards ──
  const requireAuth: Guard = async (req) => {
    if (!context(req)) throw new AuthError("UNAUTHENTICATED", MESSAGES.UNAUTHENTICATED);
  };

  const assertKnown = (permission: string) => {
    if (!known.has(permission))
      throw new Error(`Unknown permission '${permission}' (AUTHZ-PERM-004)`);
  };

  const requirePermission = (permission: string): Guard => {
    assertKnown(permission);
    return async (req) => {
      const auth = context(req);
      if (!auth) throw new AuthError("UNAUTHENTICATED", MESSAGES.UNAUTHENTICATED);
      if (!auth.permissions.has(permission)) throw new AuthError("FORBIDDEN", MESSAGES.FORBIDDEN);
      req.selfauthAuthorized = true;
    };
  };

  const authorizeResource = (
    permission: string,
    resource: (req: FastifyRequest) => { type: string; id: string },
  ): Guard => {
    assertKnown(permission);
    return async (req) => {
      const auth = context(req);
      if (!auth) throw new AuthError("UNAUTHENTICATED", MESSAGES.UNAUTHENTICATED);
      const { type, id } = resource(req);
      const decision = await policies.decide(auth, permission, type, id);
      if (decision === "allow") {
        req.selfauthAuthorized = true;
        return;
      }
      throw decision === "not_found"
        ? new AuthError("NOT_FOUND", MESSAGES.NOT_FOUND)
        : new AuthError("FORBIDDEN", MESSAGES.FORBIDDEN);
    };
  };

  const denyUnlessAuthorized: Guard = async (req) => {
    if (req.selfauthAuthorized !== true) throw new AuthError("FORBIDDEN", MESSAGES.FORBIDDEN);
  };

  const joinPath = (prefix: string, path: string) =>
    path === "/" ? prefix || "/" : `${prefix}${path}`;

  const protectedRoutes = (app: FastifyInstance, prefix = ""): ProtectedRoutes => {
    const api = {} as ProtectedRoutes;
    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      api[method] = (path, ...rest) => {
        const handler = rest.pop() as RouteHandlerMethod | undefined;
        if (!handler) throw new Error("route needs a handler");
        app.route({
          method: method.toUpperCase() as Uppercase<Method>,
          url: joinPath(prefix, path),
          // Order matters: sign-in first, then your guards, then the deny-by-default check.
          preHandler: [requireAuth, ...(rest as Guard[]), denyUnlessAuthorized],
          handler,
        });
        return api;
      };
    }
    return api;
  };

  // ── routes (HTTP binding: AUTHENTICATION_SPEC §11) ──
  const authed = (req: FastifyRequest): AuthContext => {
    const auth = context(req);
    if (!auth) fail("UNAUTHENTICATED");
    return auth;
  };

  const registerRoutes = (app: FastifyInstance) => {
    app.addHook("onRequest", async (_req, reply) => {
      reply.header("Cache-Control", "no-store"); // AUTHN-ME-003, SEC-HTTP-001
      reply.header("Referrer-Policy", "no-referrer");
    });

    app.post("/register", async (req, reply) => {
      const result = await service.register(body(req), ctx(req));
      if (result.kind === "signedIn") {
        setSessionCookie(reply, result.issued);
        return reply.code(201).send({ user: result.user, ...csrfField(result.issued.session.id) });
      }
      return reply.code(202).send({ status: "accepted" });
    });

    app.post("/login", async (req, reply) => {
      const { user, issued } = await service.login(body(req), req.selfauthToken, ctx(req));
      setSessionCookie(reply, issued);
      return reply.code(200).send({ user, ...csrfField(issued.session.id) });
    });

    app.post("/logout", async (req, reply) => {
      await service.logout(req.selfauthToken, ctx(req));
      clearSessionCookie(reply);
      return reply.code(204).send();
    });

    app.post("/logout-all", async (req, reply) => {
      await service.logoutAll(authed(req), ctx(req));
      clearSessionCookie(reply);
      return reply.code(204).send();
    });

    app.get("/me", async (req, reply) => {
      const auth = authed(req);
      return reply.send({ ...(await service.currentUser(auth)), ...csrfField(auth.session.id) });
    });

    app.get("/sessions", async (req, reply) => {
      return reply.send({ sessions: await service.listSessions(authed(req)) });
    });

    app.delete("/sessions/:id", async (req, reply) => {
      await service.revokeSession(authed(req), param(req, "id"), ctx(req));
      return reply.code(204).send();
    });

    app.post("/email/verification", async (req, reply) => {
      await service.requestEmailVerification(body(req), ctx(req));
      return reply.code(202).send({ status: "accepted" });
    });

    app.post("/email/verify", async (req, reply) => {
      await service.verifyEmail(body(req), ctx(req));
      return reply.code(200).send({ status: "verified" });
    });

    app.post("/password/change", async (req, reply) => {
      const issued = await service.changePassword(authed(req), body(req), ctx(req));
      setSessionCookie(reply, issued);
      return reply.code(200).send({ status: "changed", ...csrfField(issued.session.id) });
    });

    app.post("/password/reset-request", async (req, reply) => {
      await service.requestPasswordReset(body(req), ctx(req));
      return reply.code(202).send({ status: "accepted" });
    });

    app.post("/password/reset", async (req, reply) => {
      await service.resetPassword(body(req), ctx(req));
      return reply.code(204).send();
    });

    app.post("/account/delete", async (req, reply) => {
      await service.deleteAccount(authed(req), body(req), ctx(req));
      clearSessionCookie(reply);
      return reply.code(204).send();
    });

    app.post("/admin/users/:id/state", async (req, reply) => {
      await service.setAccountState(authed(req), param(req, "id"), body(req), ctx(req));
      return reply.code(204).send();
    });

    app.post("/admin/users/:id/roles", async (req, reply) => {
      await service.assignRole(authed(req), param(req, "id"), body(req), ctx(req));
      return reply.code(204).send();
    });

    app.delete("/admin/users/:id/roles/:role", async (req, reply) => {
      await service.removeRole(authed(req), param(req, "id"), param(req, "role"), ctx(req));
      return reply.code(204).send();
    });
  };

  const handleError = (error: unknown, req: FastifyRequest, reply: FastifyReply): boolean => {
    if (!(error instanceof AuthError)) return false;
    if (error.retryAfterSeconds !== undefined)
      reply.header("Retry-After", String(error.retryAfterSeconds));
    reply.header("Cache-Control", "no-store");
    void reply.code(HTTP_STATUS[error.code]).send({
      error: {
        code: error.code,
        message: error.message,
        requestId: options.requestId(req),
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return true;
  };

  const install = (app: FastifyInstance) => {
    app.decorateRequest("selfauth", null);
    app.decorateRequest("selfauthToken", undefined);
    app.decorateRequest("selfauthAuthorized", false);
    app.addHook("onRequest", cors);
    app.addHook("onRequest", session);
    app.addHook("onRequest", csrf);
    // The routes live in their own scope so their headers apply to them only.
    void app.register(async (scope) => registerRoutes(scope), { prefix: config.http.basePath });
  };

  return {
    install,
    handleError,
    context,
    requireAuth,
    requirePermission,
    authorizeResource,
    protectedRoutes,
  };
}
