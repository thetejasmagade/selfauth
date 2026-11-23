# SelfAuth Next.js reference frontend

The account pages and the browser module for a Next.js app (App Router), and the source that
`selfauth init --frontend next` copies from. It works with any SelfAuth backend: `src/proxy.ts`
forwards `/auth` and `/api` to the backend named by `SELFAUTH_API_TARGET`, read when a request
arrives, so one build runs against any of them. With `--backend next` the same files sit next to the
API in one app (and `proxy.ts` is left out).

- `src/auth-client/` is application-owned frontend code. The framework-neutral files (`client.ts`,
  `redirect.ts`, `url-token.ts`, `messages.ts`, `types.ts`) are identical to the React and Vue ones
  (a test fails if they drift); `react.tsx` is the Next.js layer. The session is looked up in the
  browser (`store.start()`), so a page is the same HTML for everyone.
- `src/app/` has the pages; `src/screens/` has what they draw. The folder is not called `pages`,
  which Next.js would read as the Pages Router.

```bash
pnpm --filter @selfauth/playground-next dev           # backend on :3000
pnpm --filter @selfauth/playground-next-web dev       # frontend on :5175 (forwards /auth, /api)
```

Set `SELFAUTH_APP_BASE_URL=http://localhost:5175` for the backend so email links open this app.
