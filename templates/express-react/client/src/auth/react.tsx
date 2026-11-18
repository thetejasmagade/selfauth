/**
 * React integration for the SelfAuth client (application-owned, Phase 5).
 * <RequireAuth> and <Can> improve UX only; the backend authorizes every
 * request (AUTHZ-CORE-004).
 */
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import type { AuthClient, CurrentUser, PublicUser } from "./client.ts";
import { safeRedirect } from "./redirect.ts";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthSnapshot {
  status: AuthStatus;
  user: PublicUser | null;
  session: CurrentUser["session"] | null;
}

export interface AuthStore {
  client: AuthClient;
  /** Resolves once the initial session check has finished. */
  ready: Promise<void>;
  getSnapshot(): AuthSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  login(email: string, password: string): Promise<PublicUser>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
  /** Called when the server says the session ended (expired, revoked elsewhere). */
  markSignedOut(): void;
}

export function createAuthStore(client: AuthClient): AuthStore {
  let snapshot: AuthSnapshot = { status: "loading", user: null, session: null };
  const listeners = new Set<() => void>();
  const set = (current: CurrentUser | null) => {
    // A new object per change, as useSyncExternalStore requires.
    snapshot = {
      status: current ? "authenticated" : "unauthenticated",
      user: current?.user ?? null,
      session: current?.session ?? null,
    };
    for (const l of listeners) l();
  };
  const refresh = async () => {
    try {
      set(await client.me());
    } catch {
      set(null);
    }
  };
  return {
    client,
    ready: refresh(),
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    async login(email, password) {
      const user = await client.login({ email, password });
      await refresh(); // session details and, in token mode, the CSRF token
      return user;
    },
    async logout() {
      try {
        await client.logout();
      } finally {
        set(null);
      }
    },
    async logoutAll() {
      try {
        await client.logoutAll();
      } finally {
        set(null);
      }
    },
    markSignedOut: () => set(null),
  };
}

const AuthContext = createContext<AuthStore | null>(null);

export function AuthProvider({ store, children }: { store: AuthStore; children: ReactNode }) {
  return <AuthContext.Provider value={store}>{children}</AuthContext.Provider>;
}

export interface UseAuth extends AuthSnapshot {
  store: AuthStore;
  client: AuthClient;
  isAuthenticated: boolean;
  can(permission: string): boolean;
  hasRole(role: string): boolean;
}

export function useAuth(): UseAuth {
  const store = useContext(AuthContext);
  if (!store) throw new Error("useAuth() must be used inside <AuthProvider>");
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return {
    ...state,
    store,
    client: store.client,
    isAuthenticated: state.status === "authenticated",
    can: (permission) => state.user?.permissions.includes(permission) ?? false,
    hasRole: (role) => state.user?.roles.includes(role) ?? false,
  };
}

/** Renders children only for signed-in users (holding `permission`, if given). */
export function RequireAuth({
  children,
  permission,
  loginPath = "/login",
  forbiddenPath = "/forbidden",
  loading = null,
}: {
  children: ReactNode;
  permission?: string;
  loginPath?: string;
  forbiddenPath?: string;
  loading?: ReactNode;
}) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "loading") return <>{loading}</>;
  if (!auth.isAuthenticated) {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`${loginPath}?redirect=${redirect}`} replace />;
  }
  if (permission && !auth.can(permission)) return <Navigate to={forbiddenPath} replace />;
  return <>{children}</>;
}

/** Renders children only for signed-out users; others go to a validated `?redirect=`. */
export function GuestOnly({ children, home = "/" }: { children: ReactNode; home?: string }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "loading") return null;
  if (auth.isAuthenticated) {
    const target = new URLSearchParams(location.search).get("redirect");
    return <Navigate to={safeRedirect(target, home)} replace />;
  }
  return <>{children}</>;
}

/** `<Can permission="orders.view">…</Can>` — permission-aware UI (UX only). */
export function Can({
  permission,
  role,
  children,
  fallback = null,
}: {
  permission?: string;
  role?: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const auth = useAuth();
  const allowed =
    auth.isAuthenticated &&
    (permission === undefined || auth.can(permission)) &&
    (role === undefined || auth.hasRole(role));
  return <>{allowed ? children : fallback}</>;
}
