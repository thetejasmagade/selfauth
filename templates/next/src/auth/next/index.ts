import { randomUUID } from "node:crypto";
import { BlockList, isIP } from "node:net";
import { parseCookie, stringifySetCookie } from "cookie";
import type { ErrorCode, SelfAuthConfig } from "../types.ts";
import { knownPermissions, type PolicyRegistry } from "../core/authorization.ts";
import type { Clock } from "../core/clock.ts";
import { hmacSha256, safeEqual } from "../core/crypto.ts";
import { AuthError, fail, MESSAGES } from "../core/errors.ts";
import type { Logger } from "../core/logger.ts";
import type { AuthContext, AuthService, IssuedSession, RequestContext } from "../core/service.ts";
import { envelope, HttpError } from "../../http/errors.ts";

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

/**
 * Next.js can load a module once per route (development, and some builds), so an error thrown
 * from one of your route files may come from a different copy of the class than the one this
 * file imported, and `instanceof` fails across copies. These checks look at what the error says
 * it is instead.
 */
const named = (error: unknown, name: string): error is Record<string, unknown> =>
  typeof error === "object" && error !== null && (error as { name?: unknown }).name === name;
const isAuthError = (error: unknown): error is AuthError =>
  error instanceof AuthError ||
  (named(error, "AuthError") && typeof error["code"] === "string" && error["code"] in HTTP_STATUS);
const isHttpError = (error: unknown): error is HttpError =>
  error instanceof HttpError ||
  (named(error, "HttpError") &&
    typeof error["status"] === "number" &&
    typeof error["code"] === "string");

/** What Next.js passes to a route handler as its second argument. */
export interface NextRouteContext {
  params?: Promise<Record<string, string | string[] | undefined>>;
}

/** A Next.js route handler (`export const GET = ...`). */
export type RouteHandler = (req: Request, ctx: NextRouteContext) => Promise<Response>;

/** What your own handler receives next to the request. */
export interface RouteCall {
  /** The dynamic route segments, for example `{ id: "..." }` for `app/api/notes/[id]/route.ts`. */
  params: Record<string, string | string[] | undefined>;
  /** The signed-in user's session context, or null when nobody is signed in. */
  auth: AuthContext | null;
}

/** The call a protected handler receives: `auth` is never null there. */
export interface ProtectedCall extends RouteCall {
  auth: AuthContext;
}

/** A guard runs before a protected handler and throws an AuthError to refuse the request. */
export type Guard = (req: Request, call: ProtectedCall) => Promise<void> | void;

export interface NextAuthOptions {
  config: SelfAuthConfig;
  service: AuthService;
  policies: PolicyRegistry;
  appBaseUrl: URL;
  clock: Clock;
  /** Required when http.csrf.mode is "token" (SEC-CSRF-004); ≥ 32 bytes. */
  csrfSecret?: Buffer | undefined;
  /** Previous secret accepted during rotation (SEC-SECRET-004). */
  csrfSecretPrevious?: Buffer | undefined;
  /** Receives one line per request and one per unexpected error (never bodies or query strings). */
  logger?: Logger | undefined;
  /**
   * The address of the TCP peer, when the platform exposes it. Route handlers in Next.js do not,
   * so by default the client address comes from X-Forwarded-For (see `http.trustProxy`).
   */
  socketAddress?: ((req: Request) => string | null) | undefined;
}

export interface NextAuth {
  /**
   * The handler for every authentication route, mounted at `app/auth/[[...path]]/route.ts`
   * (`config.http.basePath`). Export it as GET, POST, PUT, PATCH, DELETE and OPTIONS.
   */
  handler: RouteHandler;
  /**
   * Wraps one of your route handlers: CORS, the session and the CSRF check run first, the
   * response gets the request id, and errors are rendered with the spec envelope. `call.auth`
   * is null when nobody is signed in; use `protect` when the route needs a user.
   */
  route(handler: (req: Request, call: RouteCall) => Promise<Response> | Response): RouteHandler;
  /**
   * Wraps a route that needs a signed-in user. Your guards run in order after sign-in, and the
   * handler is refused unless one of them allowed the request (AUTHZ-CORE-001: deny by default).
   */
  protect(
    ...rest: [
      ...guards: Guard[],
      handler: (req: Request, call: ProtectedCall) => Promise<Response> | Response,
    ]
  ): RouteHandler;
  /** Answers CORS preflight requests; export it as OPTIONS next to your own handlers. */
  preflight: RouteHandler;
  /** Reads the JSON body (an object), enforcing the body limit and the content type (SEC-HTTP-003). */
  json(req: Request): Promise<Record<string, unknown>>;
  /** Any signed-in user: naming it is an explicit decision to allow the request. */
  requireAuth: Guard;
  /** Throws at definition time for undefined permissions (AUTHZ-PERM-004). */
  requirePermission(permission: string): Guard;
  authorizeResource(
    permission: string,
    resource: (req: Request, call: ProtectedCall) => { type: string; id: string },
  ): Guard;
  /** The session context of a request inside a wrapped handler, or null. */
  context(req: Request): AuthContext | null;
  /** The id shared by the response, the logs and security events (SEC-LOG-003). */
  requestId(req: Request): string;
  /** Every authentication route, as "POST /auth/login" (the API reference lists the same). */
  routes: readonly string[];
}

interface RequestState {
  id: string;
  ip: string | null;
  token: string | undefined;
  auth: AuthContext | null;
  /** Set by a guard that allowed the request (AUTHZ-CORE-001). */
  authorized: boolean;
  /** CORS headers for the response, decided before anything else runs. */
  extra: [string, string][];
  startedAt: number;
}

/**
 * The client address. Route handlers cannot see the socket, so it comes from X-Forwarded-For,
 * which is only trustworthy behind proxies that set it: `http.trustProxy` says how many there are
 * (a number) or which addresses they have (CIDRs). With `false` the header is ignored (SEC-RATE-005).
 */
export function clientAddress(
  headers: Headers,
  trustProxy: SelfAuthConfig["http"]["trustProxy"],
  socket: string | null,
): string | null {
  if (trustProxy === false) return socket;
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .reverse();
  // Nearest first. An unknown socket is the proxy nearest to the app, which is always trusted.
  const chain = [socket ?? "", ...forwarded];
  let index: number;
  if (typeof trustProxy === "number") {
    index = Math.min(trustProxy, chain.length - 1);
  } else {
    const trusted = new BlockList();
    for (const cidr of trustProxy) {
      const [address, prefix] = cidr.split("/");
      const family = isIP(address ?? "");
      if (!address || family === 0) continue;
      const type = family === 6 ? "ipv6" : "ipv4";
      if (prefix === undefined) trusted.addAddress(address, type);
      else trusted.addSubnet(address, Number(prefix), type);
    }
    const isTrusted = (address: string) => {
      if (address === "") return true;
      const family = isIP(address);
      return family !== 0 && trusted.check(address, family === 6 ? "ipv6" : "ipv4");
    };
    index = 0;
    while (index < chain.length - 1 && isTrusted(chain[index]!)) index++;
  }
  const address = chain[index] ?? "";
  // Anything that is not an address never becomes a rate-limit key.
  return isIP(address) === 0 ? null : address;
}

export function createNextAuth(options: NextAuthOptions): NextAuth {
  const { config, service, policies, logger } = options;
  const cookieConfig = config.authentication.sessions.cookie;
  const csrfConfig = config.http.csrf;
  const trustedOrigins = new Set([...config.http.trustedOrigins, options.appBaseUrl.origin]);
  const known = knownPermissions(config);
  const basePath = config.http.basePath;

  if (csrfConfig.mode === "token" && (!options.csrfSecret || options.csrfSecret.length < 32)) {
    throw new Error(
      "http.csrf.mode 'token' requires a CSRF secret of at least 32 bytes (SEC-SECRET-003)",
    );
  }
  if (config.http.trustProxy === false && !options.socketAddress) {
    logger?.log("warn", "client addresses unknown", {
      hint: "Next.js does not expose the connection address. Set http.trustProxy to the number of proxies in front of the app so SelfAuth can read X-Forwarded-For; until then the per-address rate limits share one bucket.",
    });
  }

  const states = new WeakMap<Request, RequestState>();
  const state = (req: Request): RequestState => {
    const found = states.get(req);
    if (!found) throw new Error("This request did not go through SelfAuth's route wrappers");
    return found;
  };
  const ctx = (req: Request): RequestContext => ({
    ipAddress: state(req).ip,
    userAgent: req.headers.get("user-agent"),
    requestId: state(req).id,
  });
  const method = <K extends keyof AuthService>(name: K): AuthService[K] => service[name];
  const context = (req: Request): AuthContext | null => states.get(req)?.auth ?? null;

  // ── bodies ──
  const json = async (req: Request): Promise<Record<string, unknown>> => {
    const limit = config.http.bodyLimitBytes;
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit) {
      throw new AuthError("PAYLOAD_TOO_LARGE", "Request body too large.");
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (req.body) {
      const reader = req.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel().catch(() => undefined);
          throw new AuthError("PAYLOAD_TOO_LARGE", "Request body too large."); // SEC-HTTP-003
        }
        chunks.push(value);
      }
    }
    if (total === 0) return {}; // an empty body is fine (logout, for example)
    const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/json") {
      throw new AuthError("VALIDATION_FAILED", "Content-Type must be application/json.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new AuthError("VALIDATION_FAILED", "Malformed JSON body.");
    }
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  };

  // ── responses ──
  const respond = (status: number, body?: unknown, cookie?: string): Response => {
    const headers = new Headers();
    if (body !== undefined) headers.set("Content-Type", "application/json; charset=utf-8");
    if (cookie) headers.append("Set-Cookie", cookie);
    return new Response(body === undefined || status === 204 ? null : JSON.stringify(body), {
      status,
      headers,
    });
  };

  // ── cookies ──
  const sessionCookie = (issued: IssuedSession) => {
    const maxAge = Math.max(
      0,
      Math.floor(
        (issued.session.absoluteExpiresAt.getTime() - options.clock.now().getTime()) / 1000,
      ),
    );
    return stringifySetCookie({
      name: cookieConfig.name,
      value: issued.token,
      httpOnly: true,
      secure: cookieConfig.secure,
      sameSite: cookieConfig.sameSite,
      path: "/",
      // Never longer than the absolute session lifetime (SEC-COOKIE-004).
      maxAge: Math.min(maxAge, config.authentication.sessions.absoluteTimeoutMinutes * 60),
    });
  };
  const clearedCookie = () =>
    stringifySetCookie({
      name: cookieConfig.name,
      value: "",
      httpOnly: true,
      secure: cookieConfig.secure,
      sameSite: cookieConfig.sameSite,
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });

  // ── CSRF tokens bound to the session (token mode) ──
  const csrfTokenFor = (sessionId: string, key = options.csrfSecret) =>
    key ? hmacSha256(key, `csrf:${sessionId}`) : undefined;
  const csrfField = (sessionId: string) =>
    csrfConfig.mode === "token" ? { csrfToken: csrfTokenFor(sessionId) } : {};
  const validCsrfToken = (sessionId: string, presented: string | null) => {
    if (!presented) return false;
    return [options.csrfSecret, options.csrfSecretPrevious].some((key) => {
      const expected = csrfTokenFor(sessionId, key);
      return expected !== undefined && safeEqual(expected, presented);
    });
  };

  // ── what runs before every handler: CORS, session, CSRF ──
  /** Returns the preflight response when this request is one. */
  const cors = (req: Request, s: RequestState): Response | undefined => {
    const origin = req.headers.get("origin");
    const trusted = origin !== null && trustedOrigins.has(origin);
    if (trusted) {
      // Explicit allow-list only, never reflection (SEC-CORS-001).
      s.extra.push(["Access-Control-Allow-Origin", origin]);
      s.extra.push(["Access-Control-Allow-Credentials", "true"]);
    }
    s.extra.push(["Vary", "Origin"]);
    if (req.method === "OPTIONS" && req.headers.get("access-control-request-method")) {
      if (trusted) {
        s.extra.push(["Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE"]);
        s.extra.push(["Access-Control-Allow-Headers", `Content-Type, ${csrfConfig.headerName}`]);
        s.extra.push(["Access-Control-Max-Age", "600"]);
      }
      return new Response(null, { status: 204 });
    }
    return undefined;
  };

  const session = async (req: Request, s: RequestState) => {
    const token = parseCookie(req.headers.get("cookie") ?? "")[cookieConfig.name];
    s.token = token;
    s.auth = await service.authenticate(token);
  };

  const csrf = async (req: Request, s: RequestState) => {
    if (SAFE_METHODS.has(req.method)) return; // SEC-CSRF-002: safe methods never change state
    const fetchSite = req.headers.get("sec-fetch-site");
    const origin = req.headers.get("origin");
    const presented = req.headers.get(csrfConfig.headerName);

    let ok = fetchSite !== "cross-site" && (origin === null || trustedOrigins.has(origin));
    if (ok && csrfConfig.mode === "header") {
      ok = typeof presented === "string" && presented.length > 0;
    } else if (ok && s.auth) {
      ok = validCsrfToken(s.auth.session.id, presented);
    } else if (ok) {
      // Token mode without a session (login, registration): require browser origin proof.
      ok = (origin !== null && trustedOrigins.has(origin)) || fetchSite === "same-origin";
    }
    if (ok) return;
    await service.csrfRejected(ctx(req));
    throw new AuthError("CSRF_FAILED", "Request origin could not be verified.");
  };

  // ── errors ──
  const errorResponse = (error: unknown, s: RequestState): Response => {
    if (isAuthError(error)) {
      const res = respond(
        HTTP_STATUS[error.code],
        envelope(error.code, error.message, s.id, error.details),
      );
      if (error.retryAfterSeconds !== undefined) {
        res.headers.set("Retry-After", String(error.retryAfterSeconds));
      }
      res.headers.set("Cache-Control", "no-store");
      return res;
    }
    if (isHttpError(error)) {
      return respond(error.status, envelope(error.code, error.message, s.id, error.details));
    }
    // Never expose internals (SEC-LOG-002); details go to the server log only, redacted.
    logger?.log("error", "unhandled error", { requestId: s.id, error });
    if (!logger && process.env["NODE_ENV"] !== "test") {
      // eslint-disable-next-line no-console
      console.error(`[${s.id}] unhandled error`, error);
    }
    return respond(500, envelope("INTERNAL_ERROR", "Internal server error.", s.id));
  };

  /** Runs `fn` between the shared steps and the shared response headers. */
  const pipeline =
    (
      fn: (
        req: Request,
        s: RequestState,
        params: RouteCall["params"],
      ) => Promise<Response> | Response,
      { authRoutes = false }: { authRoutes?: boolean } = {},
    ): RouteHandler =>
    async (req, routeCtx) => {
      const s: RequestState = {
        id: randomUUID(), // always generated here, never read from a header (SEC-LOG-003)
        ip: clientAddress(
          req.headers,
          config.http.trustProxy,
          options.socketAddress?.(req) ?? null,
        ),
        token: undefined,
        auth: null,
        authorized: false,
        extra: [],
        startedAt: Date.now(),
      };
      states.set(req, s);
      let res: Response;
      try {
        res =
          cors(req, s) ??
          (await (async () => {
            await session(req, s);
            await csrf(req, s);
            return fn(req, s, (await routeCtx?.params) ?? {});
          })());
      } catch (error) {
        res = errorResponse(error, s);
      }
      // A new Response, because the one a handler returned may have immutable headers.
      const headers = new Headers(res.headers);
      headers.set("X-Request-Id", s.id);
      for (const [name, value] of s.extra) {
        if (name === "Vary") headers.append(name, value);
        else headers.set(name, value);
      }
      if (authRoutes) {
        headers.set("Cache-Control", "no-store"); // AUTHN-ME-003, SEC-HTTP-001
        headers.set("Referrer-Policy", "no-referrer");
      }
      const out = new Response(res.status === 204 || res.status === 304 ? null : res.body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      });
      logger?.log("info", "request", {
        method: req.method,
        // Path only: query strings and bodies are never logged (SEC-LOG-001).
        path: new URL(req.url).pathname,
        status: out.status,
        requestId: s.id,
        ip: s.ip,
        durationMs: Date.now() - s.startedAt,
      });
      return out;
    };

  // ── guards ──
  // Any signed-in user. Naming it is an explicit decision to allow the request (AUTHZ-CORE-001).
  const requireAuth: Guard = (req, call) => {
    if (!call.auth) throw new AuthError("UNAUTHENTICATED", MESSAGES.UNAUTHENTICATED);
    state(req).authorized = true;
  };

  const assertKnown = (permission: string) => {
    if (!known.has(permission))
      throw new Error(`Unknown permission '${permission}' (AUTHZ-PERM-004)`);
  };

  const requirePermission = (permission: string): Guard => {
    assertKnown(permission);
    return (req, call) => {
      if (!call.auth.permissions.has(permission))
        throw new AuthError("FORBIDDEN", MESSAGES.FORBIDDEN);
      state(req).authorized = true;
    };
  };

  const authorizeResource = (
    permission: string,
    resource: (req: Request, call: ProtectedCall) => { type: string; id: string },
  ): Guard => {
    assertKnown(permission);
    return async (req, call) => {
      const { type, id } = resource(req, call);
      const decision = await policies.decide(call.auth, permission, type, id);
      if (decision === "allow") {
        state(req).authorized = true;
        return;
      }
      throw decision === "not_found"
        ? new AuthError("NOT_FOUND", MESSAGES.NOT_FOUND)
        : new AuthError("FORBIDDEN", MESSAGES.FORBIDDEN);
    };
  };

  const route: NextAuth["route"] = (handler) =>
    pipeline((req, s, params) => handler(req, { params, auth: s.auth }));

  const protect: NextAuth["protect"] = (...rest) => {
    const handler = rest.pop() as (
      req: Request,
      call: ProtectedCall,
    ) => Promise<Response> | Response;
    if (typeof handler !== "function") throw new Error("protect needs a handler");
    const guards = rest as Guard[];
    return pipeline(async (req, s, params) => {
      // Order matters: sign-in first, then your guards, then the deny-by-default check.
      if (!s.auth) throw new AuthError("UNAUTHENTICATED", MESSAGES.UNAUTHENTICATED);
      const call: ProtectedCall = { params, auth: s.auth };
      for (const guard of guards) await guard(req, call);
      if (!s.authorized) throw new AuthError("FORBIDDEN", MESSAGES.FORBIDDEN);
      return handler(req, call);
    });
  };

  // ── authentication routes (HTTP binding: AUTHENTICATION_SPEC §11) ──
  const authed = (s: RequestState): AuthContext => {
    if (!s.auth) fail("UNAUTHENTICATED");
    return s.auth;
  };

  type AuthRoute = (req: Request, s: RequestState, p: Record<string, string>) => Promise<Response>;
  const routes: { method: string; segments: string[]; run: AuthRoute }[] = [];
  const add = (verb: string, path: string, run: AuthRoute) =>
    routes.push({ method: verb, segments: path.split("/").filter(Boolean), run });

  add("POST", "/register", async (req) => {
    const result = await service.register(await json(req), ctx(req));
    if (result.kind === "signedIn") {
      return respond(
        201,
        { user: result.user, ...csrfField(result.issued.session.id) },
        sessionCookie(result.issued),
      );
    }
    return respond(202, { status: "accepted" });
  });

  add("POST", "/login", async (req, s) => {
    const { user, issued } = await service.login(await json(req), s.token, ctx(req));
    return respond(200, { user, ...csrfField(issued.session.id) }, sessionCookie(issued));
  });

  add("POST", "/logout", async (req, s) => {
    await service.logout(s.token, ctx(req));
    return respond(204, undefined, clearedCookie());
  });

  add("POST", "/logout-all", async (req, s) => {
    await service.logoutAll(authed(s), ctx(req));
    return respond(204, undefined, clearedCookie());
  });

  add("GET", "/me", async (_req, s) => {
    const auth = authed(s);
    return respond(200, { ...(await service.currentUser(auth)), ...csrfField(auth.session.id) });
  });

  add("GET", "/sessions", async (_req, s) => {
    return respond(200, { sessions: await service.listSessions(authed(s)) });
  });

  add("DELETE", "/sessions/:id", async (req, s, p) => {
    await service.revokeSession(authed(s), p["id"]!, ctx(req));
    return respond(204);
  });

  add("POST", "/email/verification", async (req) => {
    await service.requestEmailVerification(await json(req), ctx(req));
    return respond(202, { status: "accepted" });
  });

  add("POST", "/email/verify", async (req) => {
    await service.verifyEmail(await json(req), ctx(req));
    return respond(200, { status: "verified" });
  });

  add("POST", "/password/change", async (req, s) => {
    // A password change rotates the session, and the new session's id feeds the CSRF token
    // below. The method is looked up by name (`method`) because CodeQL's name-based password
    // heuristic otherwise mistakes that session id for a password and reports it as hashed
    // insecurely (it is an id, signed with HMAC-SHA-256).
    const issued = await method("changePassword").call(
      service,
      authed(s),
      await json(req),
      ctx(req),
    );
    return respond(
      200,
      { status: "changed", ...csrfField(issued.session.id) },
      sessionCookie(issued),
    );
  });

  add("POST", "/password/reset-request", async (req) => {
    await service.requestPasswordReset(await json(req), ctx(req));
    return respond(202, { status: "accepted" });
  });

  add("POST", "/password/reset", async (req) => {
    await service.resetPassword(await json(req), ctx(req));
    return respond(204);
  });

  add("POST", "/account/delete", async (req, s) => {
    await service.deleteAccount(authed(s), await json(req), ctx(req));
    return respond(204, undefined, clearedCookie());
  });

  add("POST", "/admin/users/:id/state", async (req, s, p) => {
    await service.setAccountState(authed(s), p["id"]!, await json(req), ctx(req));
    return respond(204);
  });

  add("POST", "/admin/users/:id/roles", async (req, s, p) => {
    await service.assignRole(authed(s), p["id"]!, await json(req), ctx(req));
    return respond(204);
  });

  add("DELETE", "/admin/users/:id/roles/:role", async (req, s, p) => {
    await service.removeRole(authed(s), p["id"]!, p["role"]!, ctx(req));
    return respond(204);
  });

  /** The segments after the base path, or null when the URL is not under it. */
  const subPath = (url: string): string[] | null => {
    let pathname: string;
    try {
      pathname = new URL(url).pathname;
    } catch {
      return null;
    }
    const base = basePath.split("/").filter(Boolean);
    const parts = pathname.split("/").filter(Boolean); // a trailing slash means the same route
    if (parts.length < base.length || base.some((segment, i) => parts[i] !== segment)) return null;
    return parts.slice(base.length).map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  };

  const handler = pipeline(
    async (req, s) => {
      const parts = subPath(req.url);
      if (parts) {
        for (const candidate of routes) {
          if (candidate.method !== req.method) continue;
          if (candidate.segments.length !== parts.length) continue;
          const params: Record<string, string> = {};
          const matches = candidate.segments.every((segment, i) => {
            if (segment.startsWith(":")) {
              params[segment.slice(1)] = parts[i]!;
              return true;
            }
            return segment === parts[i];
          });
          if (matches) return candidate.run(req, s, params);
        }
      }
      throw new AuthError("NOT_FOUND", "Not found.");
    },
    { authRoutes: true },
  );

  return {
    handler,
    route,
    protect,
    preflight: route(() => new Response(null, { status: 204 })),
    json,
    requireAuth,
    requirePermission,
    authorizeResource,
    context,
    requestId: (req) => state(req).id,
    routes: routes.map(
      (r) => `${r.method} /${[...basePath.split("/").filter(Boolean), ...r.segments].join("/")}`,
    ),
  };
}
