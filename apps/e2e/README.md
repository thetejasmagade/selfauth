# SelfAuth browser tests

One Playwright spec (`tests/auth.spec.ts`) runs against **every reference
frontend** — Vue and React — each built, served with `vite preview`, and
proxying to its own Express e2e backend (`apps/playground/test/e2e-server.ts`).
Passing on both shows the frontends implement the same backend contract.

```bash
pnpm e2e                                    # from the repo root
pnpm --filter @selfauth/e2e e2e --project react
```

Covered: registration and email-link verification, unverified sign-in,
redirect safety, password reset across two browsers, HttpOnly session cookie,
token stripping and `Referrer-Policy`, role changes in the UI, and direct API
calls that bypass every frontend guard.

`@playwright/test` is pinned to the version whose Chromium this environment
ships; CI installs the matching browser with `playwright install`.
