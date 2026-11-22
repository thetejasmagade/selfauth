---
"@selfauth/cli": minor
"@selfauth/spec": minor
"@selfauth/migration": minor
---

Next.js support, as a backend and as a frontend.

- `selfauth init --backend next` generates a Next.js app whose API is SelfAuth: the authentication routes are one App Router route handler, and your own routes are `route.ts` files built with `withAuth` (`auth.protect(...)`, deny by default, or `auth.route(...)`). Every database works; all 90 conformance cases pass on the memory, PostgreSQL, SQLite and MySQL stores (MongoDB in CI).
- `--frontend next` generates the same account pages for a Next.js app. With `--backend next` the pages and the API are one package; with Express, Fastify, Gin or Flask it is a Next.js app in `client/` whose `src/proxy.ts` forwards `/auth` and `/api` to the backend at run time (`SELFAUTH_API_TARGET`). The browser suite runs Vue, React and Next.js against every backend.
- Route handlers cannot see the connection address, so the client address is read from `X-Forwarded-For` using `http.trustProxy`; the generated configuration sets `1`, and `selfauth doctor` warns when it is off.
- The configuration schema and the manifest accept `next` as a backend and as a frontend.
- `selfauth add` does not apply to an existing Next.js app: new projects only.
