# SelfAuth Vue playground — Vue 3 reference frontend

`src/auth/` is **application-owned** frontend code (the future generator
output, ADR 0017):

| File | Purpose |
| --- | --- |
| `client.ts` | Framework-neutral API client: cookies, CSRF header, typed errors |
| `vue.ts` | `createAuthStore`, `createAuthPlugin`, `useAuth()`, `installAuthGuard`, `<Can>` |
| `redirect.ts` | `safeRedirect` for `?redirect=` (SEC-REDIRECT-001) |
| `url-token.ts` | Reads and strips `#token=` on email-link pages (SEC-TOKEN-005) |
| `messages.ts` | User-facing text per error code |

Pages: sign in, create account, verify email, forgot/reset password, account
(change password, devices, sign out everywhere), notes (protected example).

## Run it

```bash
# terminal 1 — backend on :3000 (memory store, dev mailer prints links)
pnpm --filter @selfauth/playground dev
# terminal 2 — frontend on :5173, proxying /auth and /api to :3000
pnpm --filter @selfauth/playground-vue dev
```

Open http://localhost:5173. Email links are printed by the backend.

## Using it

```ts
const client = createAuthClient({ onUnauthenticated: () => store.markSignedOut() });
const store = createAuthStore(client);
installAuthGuard(router, store, { login: "/login", forbidden: "/forbidden", home: "/" });
app.use(createAuthPlugin(store)).use(router);
```

```ts
// routes
{ path: "/notes", component: Notes, meta: { requiresAuth: true } }
{ path: "/support", component: Support, meta: { permission: "notes.view_any" } }
```

```vue
<Can permission="notes.view_any">Support tools</Can>
```

Guards and `<Can>` are UX only; the backend authorizes every request.

## Tests

```bash
pnpm --filter @selfauth/playground-vue test   # unit (Vitest + happy-dom)
pnpm e2e                                       # browser tests for Vue and React (apps/e2e)
```

The client's behaviour is unit-tested here; the React app keeps identical
copies of the framework-neutral files and checks they match.

Deployment topologies (same origin, subdomains, cross site):
[`docs/frontend-deployment.md`](../../docs/frontend-deployment.md).
