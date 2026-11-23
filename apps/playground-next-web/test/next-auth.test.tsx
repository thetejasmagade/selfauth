import { act, cleanup, render, screen } from "@testing-library/react";
import { useSyncExternalStore, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthProvider,
  Can,
  createAuthStore,
  GuestOnly,
  RequireAuth,
  type AuthClient,
  type CurrentUser,
} from "../src/auth-client/index.ts";

/**
 * A stand-in for next/navigation: the address bar is the browser's own (happy-dom), and
 * `router.replace` / `router.push` change it and tell every component that reads it.
 */
const location = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const go = (url: string) => {
    window.history.replaceState(null, "", url);
    for (const l of listeners) l();
  };
  return { subscribe, go };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: location.go, push: location.go }),
  usePathname: () => useSyncExternalStore(location.subscribe, () => window.location.pathname),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function signedIn(permissions: string[], roles = ["user"]): CurrentUser {
  return {
    user: { id: "u1", email: "a@x.test", emailVerified: true, state: "active", roles, permissions },
    session: { id: "s1", createdAt: "", idleExpiresAt: "", absoluteExpiresAt: "" },
  };
}

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

/** What the real app has: a page for the current address, chosen the way the file router would. */
function Pages() {
  const path = useSyncExternalStore(location.subscribe, () => window.location.pathname);
  const search = useSyncExternalStore(location.subscribe, () => window.location.search);
  const page: Record<string, ReactNode> = {
    "/login": (
      <GuestOnly>
        <p>login form</p>
      </GuestOnly>
    ),
    "/notes": (
      <RequireAuth>
        <p>notes</p>
      </RequireAuth>
    ),
    "/support": (
      <RequireAuth permission="notes.view_any">
        <p>support</p>
      </RequireAuth>
    ),
    "/forbidden": <p>forbidden</p>,
  };
  return (
    <>
      {page[path] ?? <p>home</p>}
      <p data-testid="where">{`${path}${search}`}</p>
    </>
  );
}

async function renderAt(path: string, current: CurrentUser | null) {
  window.history.replaceState(null, "", path);
  const store = createAuthStore(fakeClient(current));
  render(
    <AuthProvider store={store}>
      <Pages />
    </AuthProvider>,
  );
  await act(() => store.start());
  return store;
}

describe("auth store", () => {
  it("looks the session up once, when asked, not when created", async () => {
    const client = fakeClient(null);
    const store = createAuthStore(client);
    expect(client.me).not.toHaveBeenCalled(); // nothing runs on the server
    expect(store.getServerSnapshot().status).toBe("loading");
    await store.start();
    await store.start();
    expect(client.me).toHaveBeenCalledTimes(1);
  });

  it("tracks sign-in and sign-out and notifies subscribers", async () => {
    const store = createAuthStore(fakeClient(null));
    await store.start();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.getSnapshot().status).toBe("unauthenticated");
    await store.login("a@x.test", "pw");
    expect(store.getSnapshot()).toMatchObject({
      status: "authenticated",
      user: { email: "a@x.test" },
    });
    await store.logout();
    expect(store.getSnapshot().user).toBeNull();
    expect(listener).toHaveBeenCalled();
  });

  it("treats a failing session check as signed out", async () => {
    const store = createAuthStore({
      me: vi.fn(async () => {
        throw new Error("down");
      }),
    } as unknown as AuthClient);
    await store.start();
    expect(store.getSnapshot().status).toBe("unauthenticated");
  });
});

describe("<RequireAuth>", () => {
  it("sends signed-out users to login with an encoded return path", async () => {
    await renderAt("/notes?tab=2", null);
    expect(screen.getByTestId("where").textContent).toBe("/login?redirect=%2Fnotes%3Ftab%3D2");
    expect(screen.getByText("login form")).toBeTruthy();
  });

  it("renders for signed-in users", async () => {
    await renderAt("/notes", signedIn(["notes.view"]));
    expect(screen.getByText("notes")).toBeTruthy();
  });

  it("shows nothing while the session is still being looked up", () => {
    window.history.replaceState(null, "", "/notes");
    const store = createAuthStore(fakeClient(signedIn([])));
    render(
      <AuthProvider store={store}>
        <Pages />
      </AuthProvider>,
    );
    expect(screen.queryByText("notes")).toBeNull();
  });

  it("redirects to forbidden when a permission is missing", async () => {
    await renderAt("/support", signedIn(["notes.view"]));
    expect(screen.getByText("forbidden")).toBeTruthy();
  });

  it("follows the session ending elsewhere", async () => {
    const store = await renderAt("/notes", signedIn(["notes.view"]));
    expect(screen.getByText("notes")).toBeTruthy();
    act(() => store.markSignedOut());
    expect(screen.getByText("login form")).toBeTruthy();
  });
});

describe("<GuestOnly>", () => {
  it("sends signed-in users to a safe redirect only", async () => {
    await renderAt("/login?redirect=https%3A%2F%2Fevil.test", signedIn([]));
    expect(screen.getByTestId("where").textContent).toBe("/");
  });

  it("honours same-origin redirects", async () => {
    await renderAt("/login?redirect=%2Fnotes", signedIn([]));
    expect(screen.getByText("notes")).toBeTruthy();
  });
});

describe("<Can>", () => {
  async function renderCan(
    current: CurrentUser | null,
    props: { permission?: string; role?: string },
  ) {
    const store = createAuthStore(fakeClient(current));
    const { container } = render(
      <AuthProvider store={store}>
        <Can {...props} fallback={<i>no</i>}>
          <b>yes</b>
        </Can>
      </AuthProvider>,
    );
    await act(() => store.start());
    return container.textContent;
  }

  it("renders by permission or role and falls back otherwise", async () => {
    expect(await renderCan(signedIn(["notes.view_any"]), { permission: "notes.view_any" })).toBe(
      "yes",
    );
    cleanup();
    expect(await renderCan(signedIn([]), { permission: "notes.view_any" })).toBe("no");
    cleanup();
    expect(await renderCan(signedIn([], ["admin"]), { role: "admin" })).toBe("yes");
    cleanup();
    expect(await renderCan(null, { permission: "notes.view_any" })).toBe("no");
  });
});
