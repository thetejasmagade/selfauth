---
title: Full-stack project structure (Vue or React)
description: The layout of a SelfAuth project with a Vue or React frontend. The server and client packages, the account pages, the router, the API proxy and where to add your own pages.
keywords: [vue, react, vite, client, server, workspace, pages, router, frontend structure, boilerplate]
---

# Full-stack project structure (Vue or React)

`npx selfauth init my-app --frontend vue` (or `react`) creates two packages in one npm workspace:

- `server/` is the API. It's exactly the [Express](./express) (or [Fastify](./fastify)) project.
- `client/` is the frontend, built with Vite.

A single `npm install` at the root installs both, and `npm run dev` starts both.

## The tree

```text
my-app/
├── package.json                   # workspace root: scripts that run both packages
├── .gitignore
├── README.md
├── server/                        # the API: see the Express page for every file
│   ├── src/ ...
│   ├── test/ ...
│   ├── prisma/ ...                # (PostgreSQL)
│   ├── package.json
│   ├── .env.example               # copy to server/.env
│   └── selfauth.manifest.json
└── client/                        # the frontend
    ├── index.html
    ├── vite.config.ts             # dev server on :5173, proxies /auth and /api to the API
    ├── package.json
    ├── tsconfig.json
    ├── selfauth.manifest.json
    └── src/
        ├── main.ts (React: main.tsx)     # entry point: creates the client, store, router
        ├── App.vue (React: App.tsx)      # ★ app shell and header
        ├── router.ts (Vue only)          # ★ the list of pages
        ├── env.d.ts
        ├── auth/                         # ⚠ SelfAuth's frontend module
        │   ├── client.ts                 #   the API client
        │   ├── vue.ts (React: react.tsx) #   session state, route guard, <Can>
        │   ├── types.ts, messages.ts     #   types and user-facing error texts
        │   ├── redirect.ts               #   safeRedirect (blocks open redirects)
        │   ├── url-token.ts              #   reads and removes #token= from the address bar
        │   └── index.ts
        └── pages/
            ├── HomePage.vue              # ★ your pages go here
            ├── AccountPage.vue           #   (React: AccountPage.tsx; the React home, forbidden
            ├── ForbiddenPage.vue         #   and not-found screens are inside App.tsx)
            ├── NotFoundPage.vue
            └── auth/                     # the five account screens
                ├── LoginPage.vue
                ├── RegisterPage.vue
                ├── VerifyEmailPage.vue
                ├── ForgotPasswordPage.vue
                └── ResetPasswordPage.vue
```

The pages are plain unstyled HTML. They work, and they're ready for your own design.

## Root scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Starts the API (`:3000`) and the Vite dev server (`:5173`) together |
| `npm run dev:server`, `npm run dev:client` | Start one of them |
| `npm run build` | Builds the server, then the client |
| `npm start` | Runs the built server |
| `npm run typecheck` | Type-checks both |
| `npm test` | Runs the server's tests |
| `npm run db:migrate`, `db:status`, `db:seed`, `db:create-admin` | Forwarded to `server/` |

## How the browser reaches the API

In development, the Vite dev server forwards `/auth` and `/api` to the API, so the browser only ever sees one origin, `http://localhost:5173`. That's the simplest setup and the one I'd recommend: cookies and CSRF just work.

The proxy lives in `client/vite.config.ts`:

```ts
const target = process.env["SELFAUTH_API_TARGET"] ?? "http://localhost:3000";
const proxy = {
  "/auth": { target, changeOrigin: false },
  "/api": { target, changeOrigin: false },
};
```

Two things follow from that:

- Your own API routes need to start with `/api` to get forwarded. A route at `/orders` won't be reachable from the browser in development unless you add it to `proxy`.
- If the API runs somewhere else, set `SELFAUTH_API_TARGET`.

The backend only trusts the frontend address in `server/.env`, `SELFAUTH_APP_BASE_URL=http://localhost:5173`. Serve the frontend from another address and you need to update it. See [Frontend deployment](/configuration/frontend-deployment).

## The account pages and their routes

| Page | Route | Who can open it |
| --- | --- | --- |
| Home | `/` | Everyone |
| Sign in | `/login` | Signed-out users only (`guestOnly`) |
| Create account | `/register` | Signed-out users only |
| Verify email | `/verify-email` | Anyone with the link from the email |
| Forgot password | `/forgot-password` | Everyone |
| Reset password | `/reset-password` | Anyone with the link from the email |
| Account | `/account` | Signed-in users (`requiresAuth`) |
| Forbidden | `/forbidden` | Where users are sent when a permission is missing |
| Not found | anything else | |

Don't rename the verify and reset routes. The server builds the links in its emails from those exact paths.

## Where your pages go

1. Create the page in `client/src/pages/`.
2. Register the route: in `client/src/router.ts` for Vue, or in the `<Routes>` of `client/src/App.tsx` for React.
3. Protect it with route meta (Vue) or `<RequireAuth>` (React).

[Add a frontend page](/build/frontend-pages) walks through a full example.
