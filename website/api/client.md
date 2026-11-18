---
title: Client API (Vue and React)
description: The generated frontend client - createAuthClient methods, AuthApiError, the Vue store, plugin and guard, and the React provider, hooks and components such as RequireAuth and Can.
keywords: [createAuthClient, AuthApiError, useAuth, RequireAuth, Can, installAuthGuard, vue, react, frontend client]
---

# Client API (Vue and React)

The code in `client/src/auth/` of projects generated with `--frontend vue|react` (or `src/selfauth/` after `add-frontend`). A
framework-neutral client plus a thin Vue or React layer. It is your code, with
no SelfAuth package at runtime .

## `createAuthClient(options)`

```ts
import { createAuthClient } from "./auth";
const client = createAuthClient({
  baseUrl: "",                 // API origin; "" for same-origin (recommended, via proxy)
  basePath: "/auth",           // must match http.basePath
  csrf: { mode: "header" },    // or "token" (sends the csrfToken from login/me)
  onUnauthenticated: () => {}, // called when the server says the session ended
});
```

| Method | HTTP |
| --- | --- |
| `register({ email, password })` → `{ signedIn, user? }` | `POST /auth/register` |
| `login({ email, password })` → `PublicUser` | `POST /auth/login` |
| `logout()`, `logoutAll()` | `POST /auth/logout`, `/auth/logout-all` |
| `me()` → `CurrentUser \| null` | `GET /auth/me` (`null` when signed out) |
| `listSessions()`, `revokeSession(id)` | `GET /auth/sessions`, `DELETE /auth/sessions/:id` |
| `requestEmailVerification(email)`, `verifyEmail(token)` | `POST /auth/email/verification`, `/auth/email/verify` |
| `changePassword({ currentPassword, newPassword })` | `POST /auth/password/change` |
| `requestPasswordReset(email)`, `resetPassword({ token, newPassword })` | `POST /auth/password/reset-request`, `/auth/password/reset` |
| `deleteAccount(currentPassword)` | `POST /auth/account/delete` |
| `api(method, path, body?)` | Any route of your own app, with the same cookie, CSRF and error handling. |

Failures throw `AuthApiError` with `code` (a spec error code, or
`NETWORK_ERROR`/`UNEXPECTED_RESPONSE`). `describeError(error)` turns it into a
user-facing message (`messages.ts`; edit it to localize).

Helpers: `safeRedirect(target, fallback)` accepts only same-site relative
paths, which blocks open redirects (SEC-REDIRECT-001). `takeTokenFromFragment()`
reads `#token=` and removes it from the address bar.

## Vue (`vue.ts`)

| Export | Use |
| --- | --- |
| `createAuthStore(client)` | Reactive session state: `state`, `isAuthenticated`, `ready`, `refresh()`, `login()`, `logout()`, `logoutAll()`, `can(permission)`, `hasRole(role)` |
| `createAuthPlugin(store)` / `useAuth()` | Provide and inject the store |
| `installAuthGuard(router, store, { login, forbidden, home })` | Route meta: `requiresAuth`, `permission`, `guestOnly` |
| `<Can permission="x.y" role="…">` | Renders its slot only when allowed (with a `fallback` slot) |

## React (`react.tsx`)

| Export | Use |
| --- | --- |
| `createAuthStore(client)` + `<AuthProvider store>` | Session state via `useSyncExternalStore` |
| `useAuth()` | `{ status, user, session, isAuthenticated, can, hasRole, store, client }`. Sign in and out with `store.login()`, `store.logout()` and `store.logoutAll()` |
| `<RequireAuth permission? loginPath? forbiddenPath?>` | Redirects signed-out users to login, with a validated return path |
| `<GuestOnly home?>` | For login and register pages |
| `<Can permission? role? fallback?>` | Permission-aware rendering |

All frontend checks are UX only: the server enforces every permission
(AUTHZ-CORE-004).
