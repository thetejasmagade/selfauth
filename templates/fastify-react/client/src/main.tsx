import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App.tsx";
import { AuthProvider, createAuthClient, createAuthStore } from "./auth/index.ts";
import "./style.css";

const client = createAuthClient({
  // Session ended elsewhere (expiry, logout on another device, suspension):
  // <RequireAuth> then sends the user to the login page.
  onUnauthenticated: () => store.markSignedOut(),
});
const store = createAuthStore(client);

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <AuthProvider store={store}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
