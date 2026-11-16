/**
 * SelfAuth browser client (application-owned, Phase 5).
 *
 * - Sends cookies (`credentials: "include"`); the session token is HttpOnly
 *   and never visible to JavaScript (SEC-COOKIE-001).
 * - Adds the CSRF header to every request (SEC-CSRF-004). In token mode the
 *   CSRF token is kept in memory only, never in localStorage.
 * - Branches on error `code`, never on message text (ERR-FORMAT-003).
 * - Permissions returned here are UI hints; the server enforces access
 *   (AUTHZ-CORE-004).
 */
import type { ErrorCode } from "./types.ts";

export interface PublicUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  state: "pending" | "active" | "suspended" | "disabled" | "deleted";
  roles: string[];
  permissions: string[];
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export interface CurrentUser {
  user: PublicUser;
  session: SessionInfo;
}

export interface SessionSummary {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
}

export type ClientErrorCode = ErrorCode | "NETWORK_ERROR" | "UNEXPECTED_RESPONSE";

export class AuthApiError extends Error {
  override name = "AuthApiError";
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly details: { field: string; issue: string }[];
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: ClientErrorCode,
    message: string,
    status: number,
    details: { field: string; issue: string }[] = [],
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface AuthClientOptions {
  /** API origin; empty for same-origin deployments (recommended). */
  baseUrl?: string;
  /** Must match `http.basePath` on the server. */
  basePath?: string;
  csrf?: { mode: "header" | "token"; headerName?: string };
  /** Called when the server reports the session is no longer valid. */
  onUnauthenticated?: () => void;
  fetch?: typeof fetch;
}

export interface AuthClient {
  register(input: {
    email: string;
    password: string;
  }): Promise<{ signedIn: boolean; user?: PublicUser }>;
  login(input: { email: string; password: string }): Promise<PublicUser>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
  /** Current user, or null when not signed in. */
  me(): Promise<CurrentUser | null>;
  listSessions(): Promise<SessionSummary[]>;
  revokeSession(id: string): Promise<void>;
  requestEmailVerification(email: string): Promise<void>;
  verifyEmail(token: string): Promise<void>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(input: { token: string; newPassword: string }): Promise<void>;
  deleteAccount(currentPassword: string): Promise<void>;
  /** Calls an application route with the same cookie and CSRF handling. */
  api<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
}

export function createAuthClient(options: AuthClientOptions = {}): AuthClient {
  const baseUrl = options.baseUrl ?? "";
  const basePath = options.basePath ?? "/auth";
  const csrfMode = options.csrf?.mode ?? "header";
  const csrfHeader = options.csrf?.headerName ?? "X-SelfAuth-CSRF";
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let csrfToken: string | undefined;

  const remember = (body: unknown) => {
    const token = (body as { csrfToken?: unknown } | null)?.csrfToken;
    if (typeof token === "string") csrfToken = token;
  };

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    notify = true,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    headers[csrfHeader] = csrfMode === "token" ? (csrfToken ?? "") : "1";

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        credentials: "include",
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new AuthApiError("NETWORK_ERROR", "The server could not be reached.", 0);
    }

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new AuthApiError(
          "UNEXPECTED_RESPONSE",
          "Unexpected response from the server.",
          response.status,
        );
      }
    }
    if (!response.ok) {
      const error = (
        data as { error?: { code?: ClientErrorCode; message?: string; details?: [] } } | null
      )?.error;
      const retry = response.headers.get("Retry-After");
      const apiError = new AuthApiError(
        error?.code ?? "UNEXPECTED_RESPONSE",
        error?.message ?? `Request failed (${response.status}).`,
        response.status,
        error?.details ?? [],
        retry ? Number(retry) : undefined,
      );
      if (apiError.code === "UNAUTHENTICATED" && notify) options.onUnauthenticated?.();
      throw apiError;
    }
    remember(data);
    return data as T;
  }

  const auth = (path: string) => `${basePath}${path}`;

  return {
    async register(input) {
      const result = await request<{ status?: string; user?: PublicUser }>(
        "POST",
        auth("/register"),
        input,
      );
      return result.user ? { signedIn: true, user: result.user } : { signedIn: false };
    },
    async login(input) {
      return (await request<{ user: PublicUser }>("POST", auth("/login"), input)).user;
    },
    async logout() {
      await request("POST", auth("/logout"));
      csrfToken = undefined;
    },
    async logoutAll() {
      await request("POST", auth("/logout-all"));
      csrfToken = undefined;
    },
    async me() {
      try {
        return await request<CurrentUser>("GET", auth("/me"), undefined, false);
      } catch (error) {
        if (error instanceof AuthApiError && error.code === "UNAUTHENTICATED") return null;
        throw error;
      }
    },
    async listSessions() {
      return (await request<{ sessions: SessionSummary[] }>("GET", auth("/sessions"))).sessions;
    },
    async revokeSession(id) {
      await request("DELETE", auth(`/sessions/${encodeURIComponent(id)}`));
    },
    async requestEmailVerification(email) {
      await request("POST", auth("/email/verification"), { email });
    },
    async verifyEmail(token) {
      await request("POST", auth("/email/verify"), { token });
    },
    async changePassword(input) {
      await request("POST", auth("/password/change"), input);
    },
    async requestPasswordReset(email) {
      await request("POST", auth("/password/reset-request"), { email });
    },
    async resetPassword(input) {
      await request("POST", auth("/password/reset"), input);
    },
    async deleteAccount(currentPassword) {
      await request("POST", auth("/account/delete"), { currentPassword });
      csrfToken = undefined;
    },
    api(method, path, body) {
      return request(method, path, body);
    },
  };
}
