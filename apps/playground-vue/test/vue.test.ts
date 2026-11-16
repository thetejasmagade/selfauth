import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  Can,
  createAuthPlugin,
  createAuthStore,
  installAuthGuard,
  type AuthClient,
  type CurrentUser,
} from "../src/auth/index.ts";

function fakeClient(current: CurrentUser | null): AuthClient {
  let me = current;
  return {
    me: vi.fn(async () => me),
    login: vi.fn(async () => {
      me = signedIn(["notes.view"]);
      return me.user;
    }),
    logout: vi.fn(async () => {
      me = null;
    }),
    logoutAll: vi.fn(async () => {
      me = null;
    }),
  } as unknown as AuthClient;
}

function signedIn(permissions: string[], roles = ["user"]): CurrentUser {
  return {
    user: { id: "u1", email: "a@x.test", emailVerified: true, state: "active", roles, permissions },
    session: { id: "s1", createdAt: "", idleExpiresAt: "", absoluteExpiresAt: "" },
  };
}

const Page = (name: string) => defineComponent({ render: () => h("p", name) });

async function setup(current: CurrentUser | null) {
  const store = createAuthStore(fakeClient(current));
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: Page("home") },
      { path: "/login", component: Page("login"), meta: { guestOnly: true } },
      { path: "/notes", component: Page("notes"), meta: { requiresAuth: true } },
      { path: "/support", component: Page("support"), meta: { permission: "notes.view_any" } },
      { path: "/forbidden", component: Page("forbidden") },
    ],
  });
  installAuthGuard(router, store, { login: "/login", forbidden: "/forbidden", home: "/" });
  await store.ready;
  return { store, router };
}

describe("auth store", () => {
  it("loads the current session and exposes permission checks", async () => {
    const { store } = await setup(signedIn(["notes.view"], ["user"]));
    expect(store.state.status).toBe("authenticated");
    expect(store.can("notes.view")).toBe(true);
    expect(store.can("notes.view_any")).toBe(false);
    expect(store.hasRole("user")).toBe(true);
  });

  it("signs in and out", async () => {
    const { store } = await setup(null);
    expect(store.state.status).toBe("unauthenticated");
    await store.login("a@x.test", "pw");
    expect(store.isAuthenticated).toBe(true);
    await store.logout();
    expect(store.isAuthenticated).toBe(false);
    expect(store.state.user).toBeNull();
  });

  it("treats a failing session check as signed out", async () => {
    const client = {
      me: vi.fn(async () => {
        throw new Error("down");
      }),
    } as unknown as AuthClient;
    const store = createAuthStore(client);
    await store.ready;
    expect(store.state.status).toBe("unauthenticated");
  });
});

describe("installAuthGuard", () => {
  it("sends signed-out users to login with a return path", async () => {
    const { router } = await setup(null);
    await router.push("/notes?tab=2");
    expect(router.currentRoute.value.fullPath).toBe("/login?redirect=/notes?tab=2");
  });

  it("blocks routes that need a missing permission", async () => {
    const { router } = await setup(signedIn(["notes.view"]));
    await router.push("/support");
    expect(router.currentRoute.value.path).toBe("/forbidden");
    await router.push("/notes");
    expect(router.currentRoute.value.path).toBe("/notes");
  });

  it("keeps signed-in users away from guest pages, honoring only safe redirects", async () => {
    const { router } = await setup(signedIn([]));
    await router.push("/login?redirect=https://evil.test");
    expect(router.currentRoute.value.path).toBe("/");
    await router.push("/login?redirect=/notes");
    expect(router.currentRoute.value.path).toBe("/notes");
  });
});

describe("<Can>", () => {
  async function render(current: CurrentUser | null, props: Record<string, string>) {
    const { store } = await setup(current);
    return mount(
      defineComponent({
        render: () => h(Can, props, { default: () => h("b", "yes"), fallback: () => h("i", "no") }),
      }),
      { global: { plugins: [createAuthPlugin(store)] } },
    );
  }

  it("renders by permission or role and falls back otherwise", async () => {
    expect(
      (await render(signedIn(["notes.view_any"]), { permission: "notes.view_any" })).text(),
    ).toBe("yes");
    expect((await render(signedIn([]), { permission: "notes.view_any" })).text()).toBe("no");
    expect((await render(signedIn([], ["admin"]), { role: "admin" })).text()).toBe("yes");
    expect((await render(null, { permission: "notes.view_any" })).text()).toBe("no");
  });
});
