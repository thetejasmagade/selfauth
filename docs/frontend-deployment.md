# Frontend deployment: cookies, CORS and CSRF

SelfAuth sessions are HttpOnly cookies (ADR 0008). How you deploy the frontend
relative to the API decides the cookie, CORS and CSRF settings. Pick the first
topology that fits.

## 1. Same origin (recommended)

The browser only talks to one origin, e.g. `https://app.example.com`. The SPA
is served from it and `/auth`, `/api` are proxied (or served) by the backend.

| Setting | Value |
| --- | --- |
| `sessions.cookie` | defaults: `__Host-session`, `Secure`, `SameSite=Lax` |
| `http.trustedOrigins` | not needed (the base URL's origin is trusted) |
| `http.csrf.mode` | `header` (default) — the client sends `X-SelfAuth-CSRF: 1` |
| CORS | none |
| `SELFAUTH_APP_BASE_URL` | `https://app.example.com` |

This is what `apps/playground-vue` does locally: Vite proxies `/auth` and
`/api` to Express, and the Playwright tests run against exactly this setup.

## 2. Same site, different subdomains

SPA on `https://app.example.com`, API on `https://api.example.com`.

| Setting | Value |
| --- | --- |
| `sessions.cookie` | `SameSite=Lax`, `Secure`; name without `__Host-` only if you must set `Domain` |
| `http.trustedOrigins` | `["https://app.example.com"]` |
| `http.csrf.mode` | `header` |
| CORS | handled by SelfAuth's allow-list (credentials allowed only for trusted origins) |
| Client | `createAuthClient({ baseUrl: "https://api.example.com" })` |

Prefer leaving the cookie host-only on `api.example.com`. Setting `Domain`
shares it with every subdomain, including any you do not control.

## 3. Cross site (different registrable domains)

SPA on `https://myapp.dev`, API on `https://api.other.io`. Browsers only send
the cookie with `SameSite=None`, which removes the browser's CSRF protection,
so token mode becomes mandatory (SEC-COOKIE-005, SEC-CSRF-004).

| Setting | Value |
| --- | --- |
| `sessions.cookie.sameSite` | `none` (schema requires `secure: true`) |
| `http.csrf.mode` | `token` (schema enforces it) |
| `SELFAUTH_CSRF_SECRET` | 32+ random bytes, base64url |
| `http.trustedOrigins` | `["https://myapp.dev"]` |
| Client | `createAuthClient({ baseUrl: "https://api.other.io", csrf: { mode: "token" } })` |

The client keeps the CSRF token in memory and refreshes it from `GET /auth/me`
after a reload. Some browsers block third-party cookies entirely; if that is a
problem, move to topology 1 or 2.

## Rules for every topology

- Never store session or CSRF tokens in `localStorage` or `sessionStorage`.
- Route guards and `<Can>` are UX. The API authorizes every request
  (AUTHZ-CORE-004); the browser tests prove it by calling protected endpoints
  directly.
- Email links land on frontend pages (`/verify-email`, `/reset-password`)
  with the token in the URL fragment. Those pages must send
  `Referrer-Policy: no-referrer` (set it on your static host and keep the
  `<meta name="referrer">` tag) and remove the fragment immediately
  (SEC-TOKEN-005).
- Post-login redirects must go through `safeRedirect` (SEC-REDIRECT-001).
- Serve everything over HTTPS in production, with HSTS (SEC-HTTP-002).
