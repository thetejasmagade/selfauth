"use client";

/**
 * React integration for the SelfAuth client in a Next.js app (application-owned).
 * <RequireAuth> and <Can> improve UX only; the backend authorizes every request (AUTHZ-CORE-004).
 *
 * The session is looked up in the browser (`GET /auth/me`) after the first render, so a page is
 * the same HTML for everyone and never caches a signed-in user.
 */
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
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
  /** Looks up the session once, in the browser; later calls return the same promise. */
  start(): Promise<void>;
  getSnapshot(): AuthSnapshot;
  /** What the server renders, and the first render in the browser: nobody is known yet. */
  getServerSnapshot(): AuthSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  login(email: string, password: string): Promise<PublicUser>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
  /** Called when the server says the session ended (expired, revoked elsewhere). */
  markSignedOut(): void;
}

const LOADING: AuthSnapshot = { status: "loading", user: null, session: null };

export function createAuthStore(client: AuthClient): AuthStore {
  let snapshot: AuthSnapshot = LOADING;
  let started: Promise<void> | undefined;
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
    start: () => (started ??= refresh()),
    getSnapshot: () => snapshot,
    getServerSnapshot: () => LOADING,
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
  useEffect(() => {
    void store.start();
  }, [store]);
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
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
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
  const router = useRouter();
  const pathname = usePathname();
  const target =
    auth.status === "loading"
      ? null
      : !auth.isAuthenticated
        ? "login"
        : permission && !auth.can(permission)
          ? "forbidden"
          : null;
  useEffect(() => {
    if (target === "forbidden") router.replace(forbiddenPath);
    if (target === "login") {
      // Read from the address bar here, so the page needs no Suspense boundary for it.
      const redirect = encodeURIComponent(`${pathname}${window.location.search}`);
      router.replace(`${loginPath}?redirect=${redirect}`);
    }
  }, [target, router, pathname, loginPath, forbiddenPath]);
  if (auth.status === "loading" || target !== null) return <>{loading}</>;
  return <>{children}</>;
}

/** Renders children only for signed-out users; others go to a validated `?redirect=`. */
export function GuestOnly({ children, home = "/" }: { children: ReactNode; home?: string }) {
  const auth = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!auth.isAuthenticated) return;
    const target = new URLSearchParams(window.location.search).get("redirect");
    router.replace(safeRedirect(target, home));
  }, [auth.isAuthenticated, router, home]);
  if (auth.status === "loading" || auth.isAuthenticated) return null;
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
