import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import {
  AuthProvider,
  Can,
  createAuthStore,
  GuestOnly,
  RequireAuth,
  type AuthClient,
  type CurrentUser,
} from "../src/auth/index.ts";

afterEach(cleanup);

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

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}

async function renderAt(path: string, current: CurrentUser | null) {
  const store = createAuthStore(fakeClient(current));
  await act(() => store.ready);
  render(
    <AuthProvider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<Where />} />
          <Route
            path="/login"
            element={
              <GuestOnly>
                <p>login form</p>
              </GuestOnly>
            }
          />
          <Route
            path="/notes"
            element={
              <RequireAuth>
                <p>notes</p>
              </RequireAuth>
            }
          />
          <Route
            path="/support"
            element={
              <RequireAuth permission="notes.view_any">
                <p>support</p>
              </RequireAuth>
            }
          />
          <Route path="/forbidden" element={<p>forbidden</p>} />
          <Route path="*" element={<Where />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </AuthProvider>,
  );
  return store;
}

describe("auth store", () => {
  it("tracks sign-in and sign-out and notifies subscribers", async () => {
    const store = createAuthStore(fakeClient(null));
    await store.ready;
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
    await store.ready;
    expect(store.getSnapshot().status).toBe("unauthenticated");
  });
});

describe("<RequireAuth>", () => {
  it("sends signed-out users to login with an encoded return path", async () => {
    await renderAt("/notes?tab=2", null);
    expect(screen.getAllByTestId("where")[0]!.textContent).toBe(
      "/login?redirect=%2Fnotes%3Ftab%3D2",
    );
    expect(screen.getByText("login form")).toBeTruthy();
  });

  it("renders for signed-in users and enforces permissions", async () => {
    await renderAt("/notes", signedIn(["notes.view"]));
    expect(screen.getByText("notes")).toBeTruthy();
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
    expect(screen.getAllByTestId("where")[0]!.textContent).toBe("/");
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
    await act(() => store.ready);
    const { container } = render(
      <AuthProvider store={store}>
        <Can {...props} fallback={<i>no</i>}>
          <b>yes</b>
        </Can>
      </AuthProvider>,
    );
    return container.textContent;
  }

  it("renders by permission or role and falls back otherwise", async () => {
    expect(await renderCan(signedIn(["notes.view_any"]), { permission: "notes.view_any" })).toBe(
      "yes",
    );
    expect(await renderCan(signedIn([]), { permission: "notes.view_any" })).toBe("no");
    expect(await renderCan(signedIn([], ["admin"]), { role: "admin" })).toBe("yes");
    expect(await renderCan(null, { permission: "notes.view_any" })).toBe("no");
  });
});
