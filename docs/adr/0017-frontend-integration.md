# ADR 0017 — Frontend integration design

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Phase 5 adds browser integrations, starting with Vue 3 (ADR 0006). The
frontend must never become the authorization authority, must not expose
session secrets to JavaScript, and must work with the cookie-based sessions
of ADR 0008.

## Decision

1. **Application-owned code, like the backend.** `apps/playground-vue/src/auth`
   is what the generator will emit: a framework-neutral `client.ts` plus a thin
   Vue layer (`vue.ts`). React gets its own thin layer over the same client
   design. No runtime SelfAuth package is required (ADR 0002/0003).
2. **Cookies only.** The session token is HttpOnly. The client uses
   `credentials: "include"`, sends the CSRF header on every request, and keeps
   a token-mode CSRF token in memory only.
3. **Same-origin by default.** The recommended topology proxies `/auth` and
   `/api` through the frontend origin (no CORS, `SameSite=Lax`).
   `docs/frontend-deployment.md` documents the subdomain and cross-site
   alternatives.
4. **UX-only guards.** Router guards (`meta.requiresAuth`, `meta.permission`,
   `meta.guestOnly`) and `<Can>` read permissions from `/auth/me` as hints.
   The browser tests call protected endpoints directly to prove the backend
   still refuses.
5. **Email-link pages** read tokens from the URL fragment, strip them with
   `history.replaceState`, and submit with `POST`; the app sets
   `Referrer-Policy: no-referrer` by header and `<meta>` (SEC-TOKEN-005).
6. **Errors by code.** UI messages are chosen from the error `code`
   (ERR-FORMAT-003), never from server text.
7. **Tests.** Vitest + happy-dom for the client, store, guards and components;
   Playwright (pinned to the version whose Chromium the environment ships) for
   end-to-end flows against the real Express backend, in CI as a separate job.
   One spec (`apps/e2e`) runs against every frontend, which share labels and
   test IDs, so "same behaviour on Vue and React" is tested rather than claimed.
8. **Copies, checked.** Until the generator renders frontend files from one
   template (Phase 6), the React app holds identical copies of the
   framework-neutral files and a test fails if they drift.

## Consequences

- One client design across frameworks; each framework layer stays small.
- Cross-site deployments need token-mode CSRF and are affected by browsers'
  third-party-cookie policies; documented rather than hidden.
