---
title: Frontend deployment
description: How to deploy your frontend relative to the API without breaking cookies, CORS or CSRF. Three topologies compared - same origin, sibling subdomains and cross-site - with the exact settings for each.
keywords: [cors, cookies, samesite, csrf, same origin, subdomain, cross-site, proxy, deployment, trustedOrigins]
---

# Frontend deployment: cookies, CORS and CSRF

SelfAuth sessions are `HttpOnly` cookies. Where you serve the frontend, relative to the API, decides the cookie, CORS and CSRF settings. Choose the first topology that fits.

```mermaid
flowchart TD
  q1{"Can one domain serve<br/>both the pages and the API?"}
  q1 -- yes --> t1["1. Same origin<br/>(recommended)"]
  q1 -- no --> q2{"Same registrable domain?<br/>app.example.com + api.example.com"}
  q2 -- yes --> t2["2. Sibling subdomains"]
  q2 -- no --> t3["3. Cross-site<br/>(token CSRF mode)"]
```

## 1. Same origin (recommended)

The browser talks to one address, for example `https://app.example.com`. The frontend is served from it, and `/auth` and `/api` are proxied to the backend. This is exactly what the development setup does: Vite proxies to the API.

| Setting | Value |
| --- | --- |
| `sessions.cookie` | the defaults: `__Host-session`, `Secure`, `SameSite=Lax` |
| `http.trustedOrigins` | not needed |
| `http.csrf.mode` | `header` (default) |
| CORS | none |
| `SELFAUTH_APP_BASE_URL` | `https://app.example.com` |
| Client | `createAuthClient({})` (same origin, the default) |

Example nginx fragment:

```nginx
location /auth { proxy_pass http://127.0.0.1:3000; proxy_set_header X-Forwarded-For $remote_addr; }
location /api  { proxy_pass http://127.0.0.1:3000; proxy_set_header X-Forwarded-For $remote_addr; }
location /     { root /var/www/app; try_files $uri /index.html; }
```

Because the API now sits behind a proxy, set `http.trustProxy: 1` so rate limits see real client addresses.

## 2. Same site, different subdomains

The frontend on `https://app.example.com`, the API on `https://api.example.com`.

| Setting | Value |
| --- | --- |
| `sessions.cookie` | `SameSite=Lax`, `Secure`. Leave the cookie host-only on the API's domain |
| `http.trustedOrigins` | `["https://app.example.com"]` |
| `http.csrf.mode` | `header` |
| CORS | handled by SelfAuth: credentials are allowed only for trusted origins |
| `SELFAUTH_APP_BASE_URL` | `https://app.example.com` |
| Client | `createAuthClient({ baseUrl: "https://api.example.com" })` |

Do not set a `Domain` on the cookie unless you must: it shares the cookie with every subdomain, including ones you do not control.

## 3. Cross-site (different registrable domains)

The frontend on `https://myapp.dev`, the API on `https://api.other.io`. Browsers only send the cookie with `SameSite=None`, which removes the browser's own CSRF protection. So token mode is mandatory.

| Setting | Value |
| --- | --- |
| `sessions.cookie.sameSite` | `none` (the schema requires `secure: true`) |
| `http.csrf.mode` | `token` (the schema enforces it) |
| `SELFAUTH_CSRF_SECRET` | 32+ random bytes, base64url |
| `http.trustedOrigins` | `["https://myapp.dev"]` |
| Client | `createAuthClient({ baseUrl: "https://api.other.io", csrf: { mode: "token" } })` |

In token mode the header carries a token bound to the session (returned by `login`, `me` and `password/change`), not the fixed value `1`. The client keeps it in memory and refreshes it from `GET /auth/me` after a reload. Some browsers block third-party cookies entirely: if that matters, use topology 1 or 2.

## Rules for every topology

- Never store session or CSRF tokens in `localStorage` or `sessionStorage`.
- Route guards and `<Can>` are convenience. The API authorizes every request.
- Email links land on frontend pages (`/verify-email`, `/reset-password`) with the token in the URL fragment. Those pages must send `Referrer-Policy: no-referrer` (set it on your static host and keep the `<meta name="referrer">` tag) and remove the fragment at once. The generated pages already do.
- Post-login redirects must go through `safeRedirect`.
- Serve everything over HTTPS in production. The server refuses to start in production when `SELFAUTH_APP_BASE_URL` is not `https://`, and the cookie is `Secure`. Add HSTS at your proxy once every subdomain serves HTTPS, for example `Strict-Transport-Security: max-age=31536000; includeSubDomains`.

## Using Gin with a Vue or React app

Gin has no generated frontend, but the Vue and React apps from `init --frontend` or `selfauth add-frontend` work against it: point the dev proxy (`SELFAUTH_API_TARGET`) at the Go server and use one of the topologies above.

## Troubleshooting

`403 CSRF_FAILED` on every POST usually means the frontend origin is not trusted or the header is missing. See [Troubleshooting](/troubleshooting#403-csrf_failed).
