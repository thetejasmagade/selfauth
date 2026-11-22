"use client";

import { useState, type ReactNode } from "react";
import { AuthProvider, createAuthClient, createAuthStore, type AuthStore } from "../auth-client/index.ts";

export function Providers({ children }: { children: ReactNode }) {
  const [store] = useState<AuthStore>(() => {
    const client = createAuthClient({
      // Session ended elsewhere (expiry, logout on another device, suspension):
      // <RequireAuth> then sends the user to the login page.
      onUnauthenticated: () => store.markSignedOut(),
    });
    const store: AuthStore = createAuthStore(client);
    return store;
  });
  return <AuthProvider store={store}>{children}</AuthProvider>;
}
