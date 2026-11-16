# SelfAuth React playground — React reference frontend

`src/auth/` is **application-owned** frontend code (ADR 0017). The
framework-neutral files (`client.ts`, `redirect.ts`, `url-token.ts`,
`messages.ts`) are identical to the Vue app's copies — a test fails if they
drift — and the React layer is `react.tsx`:

| Export | Purpose |
| --- | --- |
| `createAuthStore(client)` | Session state with `subscribe`/`getSnapshot` (for `useSyncExternalStore`) |
| `<AuthProvider store>` / `useAuth()` | State, `can()`, `hasRole()`, `client`, `store` |
| `<RequireAuth permission?>` | Redirects to `/login?redirect=…` or `/forbidden` (UX only) |
| `<GuestOnly home>` | Sends signed-in users to a validated `?redirect=` |
| `<Can permission? role? fallback?>` | Permission-aware UI (UX only) |

## Run it

```bash
pnpm --filter @selfauth/playground dev         # backend on :3000
pnpm --filter @selfauth/playground-react dev   # frontend on :5174 (proxies /auth, /api)
```

Set `SELFAUTH_APP_BASE_URL=http://localhost:5174` for the backend so email
links open this app.

## Using it

```tsx
const client = createAuthClient({ onUnauthenticated: () => store.markSignedOut() });
const store = createAuthStore(client);

<AuthProvider store={store}>
  <BrowserRouter>
    <Routes>
      <Route path="/login" element={<GuestOnly home="/notes"><LoginPage /></GuestOnly>} />
      <Route path="/notes" element={<RequireAuth><NotesPage /></RequireAuth>} />
      <Route path="/support" element={<RequireAuth permission="notes.view_any"><Support /></RequireAuth>} />
    </Routes>
  </BrowserRouter>
</AuthProvider>
```

Pages that consume one-time tokens read them once, even under React
StrictMode's double effects, because a token can only be used once.

## Tests

`pnpm --filter @selfauth/playground-react test` (Vitest + Testing Library);
browser tests run from [`apps/e2e`](../e2e) against this app and the Vue app.
