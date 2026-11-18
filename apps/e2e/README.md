# SelfAuth browser tests

One Playwright spec (`tests/auth.spec.ts`) runs against **every reference
frontend** (Vue and React) **and every reference backend** (Express and
Fastify): four projects, `vue-express`, `react-express`, `vue-fastify` and
`react-fastify`. Each frontend is built once and served with `vite preview`,
proxying to its own e2e backend (`apps/playground/test/e2e-server.ts` or
`apps/playground-fastify/test/e2e-server.ts`). Passing on all four shows the
frontends and the backends implement the same contract.

```bash
pnpm e2e                                    # from the repo root
pnpm --filter @selfauth/e2e e2e --project react-fastify
```

Covered: registration and email-link verification, unverified sign-in,
redirect safety, password reset across two browsers, HttpOnly session cookie,
token stripping and `Referrer-Policy`, role changes in the UI, and direct API
calls that bypass every frontend guard.

`@playwright/test` is pinned to the version whose Chromium this environment
ships; CI installs the matching browser with `playwright install`.
