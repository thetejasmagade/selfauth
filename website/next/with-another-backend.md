---
title: Next.js with another backend
description: Use a Next.js app as the frontend of a SelfAuth Express, Fastify, Gin or Flask API. Generate it, how the proxy forwards /auth and /api to the backend at run time, the environment, the proxy count for rate limits, and deployment.
keywords: [next.js frontend, express next.js, fastify next.js, gin next.js, flask next.js, SELFAUTH_API_TARGET, proxy.ts, same origin, trustProxy]
---

# Next.js with another backend

Next.js doesn't have to be your API. You can keep Express, Fastify, Gin or Flask for the API and use Next.js for the pages. SelfAuth generates both halves and wires them together.

```bash
npx selfauth@latest init shop --backend express --database sqlite --frontend next
```

Use `--backend fastify`, `--backend gin` or `--backend flask` the same way. The project is two folders in one npm workspace:

```text
shop/
├── server/    the API (Express here): every file from the Express guide
├── client/    the Next.js app: pages, SelfAuth's browser module, a proxy
└── package.json   npm install and npm run dev start both
```

Then:

```bash
cd shop
npm install
cp server/.env.example server/.env
npm run db:migrate && npm run db:seed
npm run dev
```

The API runs on port 3000 and the Next.js app on port 5175. Open `http://localhost:5175`, the Next.js app: that's the address people use, and the one email links point to (`SELFAUTH_APP_BASE_URL` in `server/.env`).

## How the pages reach the API

The browser only ever talks to the Next.js app. `client/src/proxy.ts` forwards every request under `/auth` and `/api` to the backend:

```ts
export function proxy(request: NextRequest) {
  const target = process.env["SELFAUTH_API_TARGET"] ?? "http://localhost:3000";
  const { pathname, search } = request.nextUrl;
  return NextResponse.rewrite(new URL(`${pathname}${search}`, target));
}

export const config = { matcher: ["/auth/:path*", "/api/:path*"] };
```

That gives you the setup [Frontend deployment](/reference/frontend-deployment) recommends: one address for the browser, so the session cookie stays `SameSite=Lax`, there's no CORS to configure, and the CSRF check passes because the request's origin is your site's.

The backend's address is read **when each request arrives**, not when you build. So you build the Next.js app once, and the same build runs against any backend: set `SELFAUTH_API_TARGET` where it runs.

| Where | `SELFAUTH_API_TARGET` |
| --- | --- |
| On your computer | not needed: the default is `http://localhost:3000` |
| In production | The API's address as the Next.js server reaches it, for example `http://api.internal:3000` |

## What you work on

Everything in the [Express](/express/), [Fastify](/fastify/), [Gin](/gin/) or [Flask](/flask/) guide applies to `server/`: routes, permissions, tables, tests. In `client/`, you build pages the way [chapter 7](./frontend-page) describes, with these two differences:

- Your API calls go through `client.api("GET", "/api/notes")` as before, and they reach the backend through the proxy.
- The pages are `src/app/*/page.tsx` and `src/screens/*`; the browser module is `src/auth-client/`.

## The rate limit and the proxy

The API now sees the Next.js server as its client, not the visitor. The visitor's address travels in the `X-Forwarded-For` header (the proxy passes it on as it arrived, or sets it to the connecting address when there was none). Tell the API to read it with `http.trustProxy` in its configuration, or every visitor shares one per-address rate limit:

| Backend | Setting |
| --- | --- |
| Express, Fastify | `"trustProxy": 1` in `server/src/config/selfauth.config.ts` |
| Flask | `"trustProxy": 1` in `server/selfauth.config.json` |
| Gin | `"trustProxy": ["127.0.0.1", "::1"]` in `server/selfauth.config.json`, or the address of the Next.js server (Gin takes addresses, not a count) |

If the Next.js app sits behind a hosting platform's proxy, that proxy sets the visitor's address first, and the count is still `1` from the API's side. If the Next.js app is open to the internet with nothing in front of it, a visitor can set the header themselves, and the per-address limit can be dodged (the per-account limit still holds). See [production](./production#_4-tell-selfauth-how-many-proxies-are-in-front-of-you).

## Deploying

Deploy two things: the API as in its own guide, and the Next.js app:

```bash
cd client
npm ci
npm run build          # needs no environment
SELFAUTH_API_TARGET=http://api.internal:3000 npm start
```

Set `SELFAUTH_APP_BASE_URL` on the **API** to the Next.js app's public `https://` address. Email links and the CSRF check both use it.

## If something went wrong

- **Every request answers `500` or hangs.** The Next.js server can't reach the API. Check `SELFAUTH_API_TARGET` and that the API is running.
- **`CSRF_FAILED` on every sign-in.** `SELFAUTH_APP_BASE_URL` on the API doesn't match the address in the browser (the Next.js app's, port 5175 in development).
- **`RATE_LIMITED` after a few sign-ins from different people.** The proxy count above isn't set on the API.
- **Your changes to `proxy.ts` do nothing.** Next.js reads it when the server starts: restart `npm run dev`.
