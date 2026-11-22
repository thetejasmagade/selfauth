# 0029: Next.js as a backend (route handlers) and as a frontend, one core

- Status: accepted
- Date: 2026-11-22

## Context

Next.js is both things people build with: it serves pages, and its App Router route handlers are
an API of their own. Asking for "Next.js support" therefore means two things: a Next.js app whose
API is SelfAuth (no separate Express server), and a Next.js app as the frontend of any other
SelfAuth backend (Express, Fastify, Gin, Flask). The core is TypeScript, so unlike Gin and Flask
(ADR 0027, 0028) it can be shared, and only the HTTP binding is new.

## Decision

- **A binding, not a port.** `apps/playground-next` is the TypeScript core (`src/auth/core`, the
  stores, the configuration) byte for byte, a test pins that, behind a binding written for the
  Fetch API: `src/auth/next/index.ts` takes a `Request` and returns a `Response`. There is no
  `app` object to install hooks on, so the order cors, session, CSRF is a pipeline that wraps each
  handler.
- **Routes are files.** The authentication routes are one catch-all, `app/auth/[[...path]]/route.ts`,
  dispatched by the adapter (the folder must match `http.basePath`). Application routes are
  ordinary `route.ts` files built with `withAuth`, which gives them `auth.route(...)` (public,
  with the session, CSRF check and error envelope) or `auth.protect(guards..., handler)` (a user is
  required, and a route no guard allowed is refused: deny by default, AUTHZ-CORE-001). A test
  fails on a route file that exports a plain function.
- **Started on the first request.** `next build` loads route modules without any environment, so
  SelfAuth is built lazily by `withAuth`, cached on `globalThis` (Next.js can load a module once per
  route), and started eagerly by `instrumentation.ts` when the server boots, so a bad variable or an
  unreachable database still stops the server with a clear message.
- **Errors are recognised by name.** Because a route may be bundled with its own copy of the error
  classes, the binding recognises `AuthError` and `HttpError` by `name` and fields, not `instanceof`.
  This was found in the real server (a 500 for a 404), not in the in-process tests.
- **The client address.** Route handlers cannot see the connection, and Next.js fills
  `X-Forwarded-For` only when the request has none. The binding reads the address from that header
  using `http.trustProxy` (a count or CIDRs, counted from the proxy side, never the left), and the
  generated configuration sets it to 1. With `false` the header is ignored and the address is
  unknown, so the per-address limits share one bucket; the binding logs that at start-up and
  `doctor` warns. With no proxy at all the header comes from the client and the per-address limits
  can be bypassed (the per-account limits still hold). This is documented in the configuration
  file, the production chapter and the adapter record's limitations.
- **The frontend is a client of the same contract.** `apps/playground-next-web` is the React
  frontend ported to the App Router: the same API client and screens, with the session looked up in
  the browser after the first render, so a page is the same HTML for everyone. Its `src/proxy.ts`
  forwards `/auth` and `/api` to the backend at run time (`SELFAUTH_API_TARGET`), so one build runs
  against any backend. A frontend folder named `pages/` would be the Pages Router, so the screens
  live in `src/screens/` and the module in `src/auth-client/` (the server's `src/auth/` is in the
  same package in a full-stack app).
- **Composed, not templated.** `selfauth init --backend next` and `--frontend next` compose the
  reference apps per database and frontend. A Next.js backend with Next.js pages is one package
  (the frontend's files next to the API's); every other pairing is `server/` + `client/` in an npm
  workspace like the rest. There are no per-combination templates beyond the browsable ones.
- **Verified end to end.** All 90 conformance cases on every store (the in-process driver calls
  the real route handlers), the same 90 browser tests for every frontend against every backend
  (15 pairs), and a generated-project smoke test per database and frontend.
- **New projects only.** `selfauth add` does not apply to an existing Next.js app.

## Consequences

- Two things only a real server showed: the cross-copy error classes above, and that Next.js's
  `role="alert"` route announcer made the browser spec's alert locator ambiguous (the spec now
  ignores it).
- A route handler's guards are validated when its handler is first built, not when the module
  loads, so a misspelled permission fails on the first request (and the test suite), not at start-up.
- Development keeps the instance on `globalThis` across hot reloads, so changes to
  `src/auth/` or the configuration need a restart of `next dev`.
- Next.js rewrites a tsconfig the first time it runs; the generated one already has what Next.js
  would add, so `selfauth validate` does not report it as changed.
