/**
 * Vue 3 integration for the SelfAuth client (application-owned, Phase 5).
 * Route guards and <Can> improve UX only; the backend authorizes every
 * request (AUTHZ-CORE-004).
 */
import {
  computed,
  defineComponent,
  inject,
  reactive,
  readonly,
  type App,
  type InjectionKey,
} from "vue";
import type { Router } from "vue-router";
import type { AuthClient, CurrentUser, PublicUser } from "./client.ts";
import { safeRedirect } from "./redirect.ts";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface State {
  status: AuthStatus;
  user: PublicUser | null;
  session: CurrentUser["session"] | null;
}

export interface AuthStore {
  readonly state: Readonly<State>;
  readonly isAuthenticated: boolean;
  client: AuthClient;
  /** Resolves once the initial session check has finished. */
  ready: Promise<void>;
  refresh(): Promise<void>;
  login(email: string, password: string): Promise<PublicUser>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
  /** Called when the server says the session ended (expired, revoked elsewhere). */
  markSignedOut(): void;
  can(permission: string): boolean;
  hasRole(role: string): boolean;
}

const KEY: InjectionKey<AuthStore> = Symbol("selfauth");

export function createAuthStore(client: AuthClient): AuthStore {
  const state = reactive<State>({ status: "loading", user: null, session: null });
  const isAuthenticated = computed(() => state.status === "authenticated");

  const set = (current: CurrentUser | null) => {
    state.user = current?.user ?? null;
    state.session = current?.session ?? null;
    state.status = current ? "authenticated" : "unauthenticated";
  };

  const refresh = async () => {
    try {
      set(await client.me());
    } catch {
      set(null);
    }
  };

  const store: AuthStore = {
    state: readonly(state) as Readonly<State>,
    get isAuthenticated() {
      return isAuthenticated.value;
    },
    client,
    ready: refresh(),
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
    markSignedOut() {
      set(null);
    },
    can(permission) {
      return state.user?.permissions.includes(permission) ?? false;
    },
    hasRole(role) {
      return state.user?.roles.includes(role) ?? false;
    },
  };
  return store;
}

export function createAuthPlugin(store: AuthStore) {
  return {
    install(app: App) {
      app.provide(KEY, store);
    },
  };
}

export function useAuth(): AuthStore {
  const store = inject(KEY);
  if (!store)
    throw new Error("useAuth() needs the SelfAuth plugin: app.use(createAuthPlugin(store))");
  return store;
}

declare module "vue-router" {
  interface RouteMeta {
    /** Only signed-in users. */
    requiresAuth?: boolean;
    /** Signed-in users holding this permission (UX only — the API still checks). */
    permission?: string;
    /** Only signed-out users (login, registration). */
    guestOnly?: boolean;
  }
}

/** Redirects unauthenticated users to `loginRoute` with a validated return path. */
export function installAuthGuard(
  router: Router,
  store: AuthStore,
  routes: { login: string; forbidden: string; home: string },
): void {
  router.beforeEach(async (to) => {
    await store.ready;
    if (to.meta.guestOnly && store.isAuthenticated) {
      return safeRedirect(to.query["redirect"], routes.home);
    }
    if ((to.meta.requiresAuth || to.meta.permission) && !store.isAuthenticated) {
      return { path: routes.login, query: { redirect: to.fullPath } };
    }
    if (to.meta.permission && !store.can(to.meta.permission)) {
      return { path: routes.forbidden };
    }
    return true;
  });
}

/**
 * Renders its slot only when the user holds `permission` (or `role`).
 * `<Can permission="notes.view_any">…</Can>`
 */
export const Can = defineComponent({
  name: "Can",
  props: {
    permission: { type: String, default: undefined },
    role: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const auth = useAuth();
    return () => {
      const allowed =
        (props.permission === undefined || auth.can(props.permission)) &&
        (props.role === undefined || auth.hasRole(props.role)) &&
        auth.isAuthenticated;
      return allowed ? slots["default"]?.() : slots["fallback"]?.();
    };
  },
});
