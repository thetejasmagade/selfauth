---
title: Connect your own frontend
description: Use a SelfAuth Express backend created with --frontend none from your own frontend (Angular, Svelte, Solid, plain JavaScript and others). Set the frontend address, reach the API without CORS errors, call it with fetch, and build the pages the email links open.
keywords: [own frontend, frontend none, api only, angular, svelte, cors, credentials include, csrf, trustedOrigins, SELFAUTH_APP_BASE_URL, fetch, proxy, verify-email, reset-password]
---

# Connect your own frontend

`--frontend none` creates the API and nothing else. This page shows how to connect a frontend you already have, or are building, to it. It works for any frontend that runs in a browser: Angular, Svelte, Solid, a framework without a name, or a single HTML file.

Using Vue, React or Next.js? You can generate the screens instead (`--frontend vue`), or add the client code to an existing app with [`selfauth add-frontend`](/reference/cli/add). This page is for everything else.

## What the API expects

Three rules cover everything a browser has to do:

1. **The session is a cookie.** After sign-in the API sends an `HttpOnly` cookie. Your code never sees or stores the token, and the browser sends the cookie back by itself. When the frontend and the API are on different addresses, your `fetch` calls need `credentials: "include"` or the browser leaves the cookie out.
2. **Requests that change something carry a header.** Every `POST`, `PUT`, `PATCH` and `DELETE` must send `X-SelfAuth-CSRF: 1`, and must come from an address the API trusts. This applies to your own routes too, not only to `/auth`.
3. **Errors have a shape.** Every failure is `{ "error": { "code": "…", "message": "…", "requestId": "…" } }`. Branch on `code`, never on `message`. The [error codes](/reference/errors) are stable.

The full list of routes, with bodies and responses, is the [HTTP API reference](/reference/http).

## 1. Start the API

Start the API with `npm run dev`. Your environment is in `.env` and your settings file is `src/config/selfauth.config.ts`.

The first time, also run the install, migrate and seed steps from your project's README, or from [chapter 1](./create-project). Then check it:

```bash
curl localhost:3000/health
```

```json
{"status":"ok"}
```

## 2. Tell the API where your frontend is

The API has to know the address your frontend is served from. Two things depend on it:

- **Which origin it trusts.** A request from any other origin is refused.
- **Where email links point.** The verification and reset emails link to this address.

Set `SELFAUTH_APP_BASE_URL` to your frontend's address, with no trailing path. For an Angular app on its default port:

```bash
SELFAUTH_APP_BASE_URL=http://localhost:4200
```

Put it in `.env`, then restart the API.

The default is `http://localhost:5173`. If your frontend is somewhere else and you skip this step, you'll see this on the first sign-in:

```json
{"error":{"code":"CSRF_FAILED","message":"Request origin could not be verified.","requestId":"…"}}
```

In the browser's console you'll also see a CORS error, because the API doesn't send CORS headers to an origin it doesn't trust.

### More than one frontend address

`SELFAUTH_APP_BASE_URL` takes one address. To trust more, for example a staging site as well as your local one, list them in `http.trustedOrigins` in the settings file:

```ts
"http": {
  "trustedOrigins": ["https://staging.example.com"]
}
```

The file is `src/config/selfauth.config.ts`. The address in `SELFAUTH_APP_BASE_URL` is always trusted as well. Origins are exact: `http://localhost:4200` and `http://127.0.0.1:4200` are different, so use the one you really type in the browser.

## 3. Let the browser reach the API

You have two ways to do this. The first is recommended.

### Option A: one address, with your dev server proxying (recommended)

Make your frontend's dev server forward `/auth` and `/api` to the API. The browser then only talks to one origin, so there's no CORS to configure and the cookie behaves the same as in production. The generated Vue and React projects work this way. In Vite it's this:

```ts
// vite.config.ts
const target = "http://localhost:3000";
export default defineConfig({
  server: {
    proxy: {
      "/auth": { target, changeOrigin: false },
      "/api": { target, changeOrigin: false },
    },
  },
});
```

Other tools have the same feature under another name: Angular uses a `proxy.conf.json` passed to `ng serve --proxy-config`, and webpack-based setups use `devServer.proxy`. Whichever you use, keep the browser's `Origin` header as it is, because the API checks it against `SELFAUTH_APP_BASE_URL`.

Your frontend then calls relative paths such as `/auth/login`.

### Option B: call the API's address directly

If you'd rather not proxy, call the API by its full address, for example `http://localhost:3000/auth/login`, from a frontend on a different port or host. This works too, as long as step 2 is done and every call uses `credentials: "include"`. Browsers treat `localhost:4200` and `localhost:3000` as the same site, so the cookie is kept. Once the API and the frontend are on different domains in production, read [Frontend deployment](/reference/frontend-deployment) first, because cookies and CSRF need different settings there.

## 4. Call the API

One small helper covers all of it. It sends the cookie, adds the header, and turns an error response into an error you can read the `code` of:

```js
const API = "";   // "" with the proxy (option A); "http://localhost:3000" for option B

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-SelfAuth-CSRF": "1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;                 // logout, for example
  const data = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(data.error.message), { code: data.error.code });
  }
  return data;
}
```

Use it like this:

```js
await call("POST", "/auth/register", { email, password });   // → { status: "accepted" }
const { user } = await call("POST", "/auth/login", { email, password });
const me = await call("GET", "/auth/me");                     // → { user, session }
await call("POST", "/auth/logout");
```

A wrong password throws an error whose `code` is `INVALID_CREDENTIALS`. An unverified account throws `EMAIL_NOT_VERIFIED`, which is your cue to show "check your inbox".

### Know who is signed in when the app loads

The session lives in a cookie your code can't read, so ask the API. Call `/auth/me` once at startup:

```js
async function currentUser() {
  try {
    return (await call("GET", "/auth/me")).user;
  } catch (error) {
    if (error.code === "UNAUTHENTICATED") return null;   // signed out
    throw error;
  }
}
```

Use the result to decide which screens to show. Hiding a screen isn't protection, because the API checks every request itself. Treat route guards in your frontend as a convenience.

### Call your own protected routes

The generated API includes one route of its own, `/api/hello`, which only signed-in users may call:

```js
await call("GET", "/api/hello");   // → { hello: "maya@example.com", database: "connected" }
```

Signed out, it throws `UNAUTHENTICATED`. Routes you add yourself work the same way, and `POST`, `PUT`, `PATCH` and `DELETE` to them need the same CSRF header, which the helper already sends.

## 5. Build the pages the emails open

Two flows start in an email, so your frontend must have a page for each. The links point at your frontend, at fixed paths:

| Email | Link | What the page does |
| --- | --- | --- |
| Verify your email | `<frontend>/verify-email#token=…` | `POST /auth/email/verify` with `{ token }` |
| Reset your password | `<frontend>/reset-password#token=…` | `POST /auth/password/reset` with `{ token, newPassword }` |

The token is in the URL **fragment** (after the `#`), so it never reaches a server log or a `Referer` header. Read it, remove it from the address bar straight away, then call the API:

```js
function takeToken() {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  history.replaceState(null, "", location.pathname);   // remove the token from the address bar
  return token;
}

// on /verify-email
await call("POST", "/auth/email/verify", { token: takeToken() });

// on /reset-password, once the user has typed a new password
await call("POST", "/auth/password/reset", { token, newPassword });
```

On the reset page, call `takeToken()` when the page loads and keep the result until the form is submitted. An invalid, used or expired token gives `TOKEN_INVALID`, always the same code, so show one message for all three.

Serve these pages with the `Referrer-Policy: no-referrer` header, as [Frontend deployment](/reference/frontend-deployment#rules-for-every-topology) explains.

Build the remaining screens the same way: sign-up (`/auth/register`), sign-in, "forgot password" (`/auth/password/reset-request` with `{ email }`), and the account screen (`/auth/password/change`, `/auth/sessions`, `/auth/logout-all`). The registration and reset-request routes answer the same whether or not the email exists, so your messages must not say whether an account was found either.

## 6. Check it works

With the API running and your frontend open:

1. Register. The API answers `{"status":"accepted"}`.
2. Find the email in the API's terminal (nothing is sent in development). The link starts with your `SELFAUTH_APP_BASE_URL`. A link that points at the wrong address means step 2 was skipped.
3. Open the link. Your verify page calls the API, and the address bar no longer shows the token.
4. Sign in. `GET /auth/me` now returns your user, and `/api/hello` greets you.
5. Sign out. `/api/hello` gives `UNAUTHENTICATED` again.

## If something goes wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| `403 CSRF_FAILED` on a `POST` | The request's origin isn't trusted, or the header is missing | Set `SELFAUTH_APP_BASE_URL` to the exact address in your browser's address bar and restart. Make sure the call sends `X-SelfAuth-CSRF: 1`. |
| A CORS error in the browser console, and `Failed to fetch` | Same cause: the API only sends CORS headers to trusted origins | Same fix. With option A you won't see CORS errors at all. |
| Sign-in works, but `/auth/me` says `UNAUTHENTICATED` right after | The cookie wasn't stored or sent | Add `credentials: "include"` to every `fetch` call, including the sign-in. |
| Verification email links open the wrong address | `SELFAUTH_APP_BASE_URL` still has the default | Set it to your frontend's address, then register again for a new link. |
| Everything works on `localhost` and fails when deployed | Cookies, `Secure` and `SameSite` differ in production | Read [Frontend deployment](/reference/frontend-deployment). |
| `RATE_LIMITED` while testing | Too many sign-in attempts | Wait 15 minutes. The limit is kept in the database, so a restart doesn't reset it. |

## Limits

The session is a cookie and the CSRF check relies on the browser, so this setup is for browser frontends. A native mobile app outside a web view isn't a supported client. Token-based access for non-browser clients (API tokens) is an optional capability in the specification, and SelfAuth doesn't implement it yet.
