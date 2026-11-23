---
title: Client API (Vue, React and Next.js)
description: The generated frontend client - createAuthClient methods, AuthApiError, the Vue store, plugin and guard, and the React provider, hooks and components such as RequireAuth and Can.
keywords: [createAuthClient, AuthApiError, useAuth, RequireAuth, Can, installAuthGuard, vue, react, frontend client]
---

# Client API (Vue, React and Next.js)

This is the code in `client/src/auth/` of projects generated with `--frontend vue|react` (`src/auth-client/` with `--frontend next`, in `client/`, or in the app itself for `--backend next`), or `src/selfauth/` after `add-frontend`. It's a framework-neutral client with a thin Vue or React layer on top. It's your code, and there's no SelfAuth package at runtime.

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

Failures throw `AuthApiError` with a `code`, which is either a spec error code or `NETWORK_ERROR` / `UNEXPECTED_RESPONSE`. `describeError(error)` turns it into a message for the user. The texts are in `messages.ts`, so edit them to localize.

Two helpers are worth knowing. `safeRedirect(target, fallback)` only accepts same-site relative paths, which blocks open redirects (SEC-REDIRECT-001). `takeTokenFromFragment()` reads `#token=` and removes it from the address bar.

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

### Next.js (`src/auth-client/react.tsx`)

The same exports as React, with these differences, because the page is drawn on the server first:

| Difference | Why |
| --- | --- |
| `createAuthStore(client)` does not look the session up. `store.start()` does, once, in the browser (`<AuthProvider>` calls it for you) | Nothing runs on the server, and a page never carries one person's name |
| The server render and the first browser render are both `status: "loading"` | The page is the same HTML for everyone |
| `<RequireAuth>` and `<GuestOnly>` redirect with the Next.js router, in an effect, and draw nothing until they know | `next/navigation` instead of a router component |
| `src/auth-client/`, not `src/auth/` | In a Next.js backend the same app's `src/auth/` is the server's code |

The framework-neutral files (`client.ts`, `redirect.ts`, `url-token.ts`, `messages.ts`, `types.ts`) are identical to the React and Vue ones.

Every frontend check is for the user's benefit only. The server enforces each permission (AUTHZ-CORE-004).
