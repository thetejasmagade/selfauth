import type { ErrorCode, SelfAuthConfig } from "@selfauth/spec";
import { parseCookie, stringifySetCookie } from "cookie";
import express, {
  type ErrorRequestHandler,
  type Request,
  type RequestHandler,
  type Response,
  type Router,
} from "express";
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

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const AUTH = "selfauth";
const AUTHORIZED = "selfauthAuthorized";
const PRESENTED = "selfauthPresentedToken";

export interface ExpressAuthOptions {
  config: SelfAuthConfig;
  service: AuthService;
  policies: PolicyRegistry;
  appBaseUrl: URL;
  clock: Clock;
  /** Required when http.csrf.mode is "token" (SEC-CSRF-004); ≥ 32 bytes. */
  csrfSecret?: Buffer | undefined;
  /** Previous secret accepted during rotation (SEC-SECRET-004). */
  csrfSecretPrevious?: Buffer | undefined;
  requestId: (res: Response) => string;
}

export interface ExpressAuth {
  /** Mount before your routes: CORS, session, CSRF. */
  middleware: RequestHandler[];
  /** Authentication routes; mount at `config.http.basePath`. */
  router: Router;
  /** Maps AuthError to the spec error envelope. Mount after routes. */
  errorHandler: ErrorRequestHandler;
  /** The validated session context, or null. */
  context(res: Response): AuthContext | null;
  requireAuth: RequestHandler;
  /** Throws at definition time for undefined permissions (AUTHZ-PERM-004). */
  requirePermission(permission: string): RequestHandler;
  authorizeResource(
    permission: string,
    resource: (req: Request) => { type: string; id: string },
  ): RequestHandler;
  /** Routes on this router are denied unless a guard explicitly allows them (AUTHZ-CORE-001). */
  protectedRoutes(router?: Router): ProtectedRoutes;
}

type Method = "get" | "post" | "put" | "patch" | "delete";
export type ProtectedRoutes = Record<
  Method,
  (path: string, ...handlers: RequestHandler[]) => ProtectedRoutes
> & {
  router: Router;
};

export function requestContext(
  req: Request,
  res: Response,
  requestId: (res: Response) => string,
): RequestContext {
  return {
    ipAddress: req.ip ?? req.socket.remoteAddress ?? null,
    userAgent: req.get("user-agent") ?? null,
    requestId: requestId(res),
  };
}

export function createExpressAuth(options: ExpressAuthOptions): ExpressAuth {
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

  const ctx = (req: Request, res: Response) => requestContext(req, res, options.requestId);
  const context = (res: Response): AuthContext | null =>
    (res.locals[AUTH] as AuthContext | null) ?? null;
  const body = (req: Request): Record<string, unknown> =>
    req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};

  // ── cookies ──
  const setSessionCookie = (res: Response, issued: IssuedSession) => {
    const maxAge = Math.max(
      0,
      Math.floor(
        (issued.session.absoluteExpiresAt.getTime() - options.clock.now().getTime()) / 1000,
      ),
    );
    res.append(
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
  const clearSessionCookie = (res: Response) => {
    res.append(
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

  // ── middleware ──
  const cors: RequestHandler = (req, res, next) => {
    const origin = req.get("origin");
    if (origin && trustedOrigins.has(origin)) {
      // Explicit allow-list only, never reflection (SEC-CORS-001).
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    res.append("Vary", "Origin");
    if (req.method === "OPTIONS" && req.get("access-control-request-method")) {
      if (origin && trustedOrigins.has(origin)) {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE");
        res.setHeader("Access-Control-Allow-Headers", `Content-Type, ${csrfConfig.headerName}`);
        res.setHeader("Access-Control-Max-Age", "600");
      }
      res.status(204).end();
      return;
    }
    next();
  };

  const session: RequestHandler = async (req, res, next) => {
    const token = parseCookie(req.get("cookie") ?? "")[cookieConfig.name];
    res.locals[PRESENTED] = token;
    res.locals[AUTH] = await service.authenticate(token);
    next();
  };

  const csrf: RequestHandler = async (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next(); // SEC-CSRF-002: safe methods never change state
    const fetchSite = req.get("sec-fetch-site");
    const origin = req.get("origin");
    const presented = req.get(csrfConfig.headerName);
    const auth = context(res);

    let ok = fetchSite !== "cross-site" && (origin === undefined || trustedOrigins.has(origin));
    if (ok && csrfConfig.mode === "header") {
      ok = typeof presented === "string" && presented.length > 0;
    } else if (ok && auth) {
      ok = validCsrfToken(auth.session.id, presented);
    } else if (ok) {
      // Token mode without a session (login, registration): require browser origin proof.
      ok = (origin !== undefined && trustedOrigins.has(origin)) || fetchSite === "same-origin";
    }
    if (ok) return next();
    await service.csrfRejected(ctx(req, res));
    next(new AuthError("CSRF_FAILED", "Request origin could not be verified."));
  };

  const requireAuth: RequestHandler = (_req, res, next) => {
    if (!context(res)) return next(new AuthError("UNAUTHENTICATED", MESSAGES.UNAUTHENTICATED));
    next();
  };

  const assertKnown = (permission: string) => {
    if (!known.has(permission))
      throw new Error(`Unknown permission '${permission}' (AUTHZ-PERM-004)`);
  };

  const requirePermission = (permission: string): RequestHandler => {
    assertKnown(permission);
    return (_req, res, next) => {
      const auth = context(res);
      if (!auth) return next(new AuthError("UNAUTHENTICATED", MESSAGES.UNAUTHENTICATED));
      if (!auth.permissions.has(permission))
        return next(new AuthError("FORBIDDEN", MESSAGES.FORBIDDEN));
      res.locals[AUTHORIZED] = true;
      next();
    };
  };

  const authorizeResource = (
    permission: string,
    resource: (req: Request) => { type: string; id: string },
  ): RequestHandler => {
    assertKnown(permission);
    return async (req, res, next) => {
      const auth = context(res);
      if (!auth) return next(new AuthError("UNAUTHENTICATED", MESSAGES.UNAUTHENTICATED));
      const { type, id } = resource(req);
      const decision = await policies.decide(auth, permission, type, id);
      if (decision === "allow") {
        res.locals[AUTHORIZED] = true;
        return next();
      }
      next(
        decision === "not_found"
          ? new AuthError("NOT_FOUND", MESSAGES.NOT_FOUND)
          : new AuthError("FORBIDDEN", MESSAGES.FORBIDDEN),
      );
    };
  };

  const denyUnlessAuthorized: RequestHandler = (_req, res, next) => {
    if (res.locals[AUTHORIZED] !== true)
      return next(new AuthError("FORBIDDEN", MESSAGES.FORBIDDEN));
    next();
  };

  const protectedRoutes = (router: Router = express.Router()): ProtectedRoutes => {
    const api = { router } as ProtectedRoutes;
    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      api[method] = (path, ...handlers) => {
        const last = handlers.pop();
        if (!last) throw new Error("route needs a handler");
        router[method](path, requireAuth, ...handlers, denyUnlessAuthorized, last);
        return api;
      };
    }
    return api;
  };

  // ── routes (HTTP binding: AUTHENTICATION_SPEC §11) ──
  const router = express.Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store"); // AUTHN-ME-003, SEC-HTTP-001
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  const authed = (req: Request, res: Response): AuthContext => {
    const auth = context(res);
    if (!auth) fail("UNAUTHENTICATED");
    return auth;
  };

  router.post("/register", async (req, res) => {
    const result = await service.register(body(req), ctx(req, res));
    if (result.kind === "signedIn") {
      setSessionCookie(res, result.issued);
      res.status(201).json({ user: result.user, ...csrfField(result.issued.session.id) });
      return;
    }
    res.status(202).json({ status: "accepted" });
  });

  router.post("/login", async (req, res) => {
    const { user, issued } = await service.login(body(req), res.locals[PRESENTED], ctx(req, res));
    setSessionCookie(res, issued);
    res.status(200).json({ user, ...csrfField(issued.session.id) });
  });

  router.post("/logout", async (req, res) => {
    await service.logout(res.locals[PRESENTED], ctx(req, res));
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.post("/logout-all", async (req, res) => {
    await service.logoutAll(authed(req, res), ctx(req, res));
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get("/me", async (req, res) => {
    const auth = authed(req, res);
    res.json({ ...(await service.currentUser(auth)), ...csrfField(auth.session.id) });
  });

  router.get("/sessions", async (req, res) => {
    res.json({ sessions: await service.listSessions(authed(req, res)) });
  });

  router.delete("/sessions/:id", async (req, res) => {
    await service.revokeSession(authed(req, res), req.params["id"] as string, ctx(req, res));
    res.status(204).end();
  });

  router.post("/email/verification", async (req, res) => {
    await service.requestEmailVerification(body(req), ctx(req, res));
    res.status(202).json({ status: "accepted" });
  });

  router.post("/email/verify", async (req, res) => {
    await service.verifyEmail(body(req), ctx(req, res));
    res.status(200).json({ status: "verified" });
  });

  router.post("/password/change", async (req, res) => {
    const issued = await service.changePassword(authed(req, res), body(req), ctx(req, res));
    setSessionCookie(res, issued);
    res.status(200).json({ status: "changed", ...csrfField(issued.session.id) });
  });

  router.post("/password/reset-request", async (req, res) => {
    await service.requestPasswordReset(body(req), ctx(req, res));
    res.status(202).json({ status: "accepted" });
  });

  router.post("/password/reset", async (req, res) => {
    await service.resetPassword(body(req), ctx(req, res));
    res.status(204).end();
  });

  router.post("/account/delete", async (req, res) => {
    await service.deleteAccount(authed(req, res), body(req), ctx(req, res));
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.post("/admin/users/:id/state", async (req, res) => {
    await service.setAccountState(
      authed(req, res),
      req.params["id"] as string,
      body(req),
      ctx(req, res),
    );
    res.status(204).end();
  });

  router.post("/admin/users/:id/roles", async (req, res) => {
    await service.assignRole(
      authed(req, res),
      req.params["id"] as string,
      body(req),
      ctx(req, res),
    );
    res.status(204).end();
  });

  router.delete("/admin/users/:id/roles/:role", async (req, res) => {
    await service.removeRole(
      authed(req, res),
      req.params["id"] as string,
      req.params["role"] as string,
      ctx(req, res),
    );
    res.status(204).end();
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (!(error instanceof AuthError)) return next(error);
    if (error.retryAfterSeconds !== undefined)
      res.setHeader("Retry-After", String(error.retryAfterSeconds));
    res.setHeader("Cache-Control", "no-store");
    res.status(HTTP_STATUS[error.code]).json({
      error: {
        code: error.code,
        message: error.message,
        requestId: options.requestId(res),
        ...(error.details ? { details: error.details } : {}),
      },
    });
  };

  return {
    middleware: [cors, session, csrf],
    router,
    errorHandler,
    context,
    requireAuth,
    requirePermission,
    authorizeResource,
    protectedRoutes,
  };
}
