---
title: How SelfAuth works
description: The architecture of SelfAuth and of the code it generates. Includes diagrams of the generator, a request through your app, and the sign-in flow.
keywords: [architecture, request lifecycle, sessions, csrf, middleware, how it works]
---

# How SelfAuth works

There are really two separate things here. The generator runs once, on your machine, while you set up the project. The app it produces is what runs in production, and it never needs the generator again.

## The generator

```mermaid
flowchart TB
  spec["Specification<br/>(rules every implementation must follow)"] --> ref["Reference apps<br/>(tested with 90 conformance cases)"]
  ref --> tpl["Templates<br/>(byte-for-byte copies)"]
  tpl --> cli["selfauth CLI"]
  cli -- "init / add" --> app["Your project<br/>(you own these files)"]
```

1. A written specification says what authentication has to do and what it must never do.
2. Reference apps implement that spec for each framework, and a suite of 90 conformance cases runs against every one.
3. The templates the CLI copies are those same tested apps, unchanged.
4. `selfauth init` copies a template into your folder and records what it wrote in `selfauth.manifest.json`.

Since the template is the tested app, there's no second "generated" flavor that could drift from what was tested.

## The generated app

Every generated backend has the same four pieces.

```mermaid
flowchart TB
  http["HTTP layer<br/>(Express, Fastify or Gin adapter)<br/>cookies, CORS, CSRF, guards, /auth routes"]
  core["Core<br/>(auth/core, no HTTP)<br/>registration, login, tokens, sessions, roles, rate limits"]
  store["Store<br/>(PostgreSQL, MySQL, SQLite, MongoDB or memory)"]
  mail["Mailer<br/>(yours: sends verification and reset emails)"]
  http --> core
  core --> store
  core --> mail
```

- The core holds the rules (registration, login, tokens, sessions, roles) and knows nothing about HTTP. It's identical across frameworks.
- The adapter translates between the web framework and the core: requests in, responses out.
- The store is where data lands. You can swap it for another database.
- The mailer is yours. SelfAuth has no idea which email provider you use, so it hands you the message and you send it.

## One request, step by step

Here's what happens when a browser asks for a protected route like `GET /api/orders`.

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as Adapter middleware
  participant G as Route guard
  participant H as Your handler
  participant S as Store
  B->>A: GET /api/orders (session cookie)
  A->>S: look up SHA-256 hash of the token
  S-->>A: session and user, or nothing
  A->>A: check expiry, revocation, CSRF on unsafe methods
  A->>G: request with the user attached
  G->>G: requirePermission("orders.view")
  alt not signed in
    G-->>B: 401 UNAUTHENTICATED
  else missing permission
    G-->>B: 403 FORBIDDEN
  else allowed
    G->>H: run the handler
    H-->>B: 200 JSON
  end
```

A few things to take from that:

- The cookie holds a random token, not any data about the user. Your server looks the session up on every request, which is why a revoked session stops working straight away.
- Permissions come from the database on each request, so the browser can't give itself any.
- Hiding a button in the UI is polish. The server is what actually says yes or no.

## The sign-in flow

```mermaid
sequenceDiagram
  participant U as User
  participant F as Frontend
  participant API as /auth routes
  participant S as Store
  U->>F: types email and password
  F->>API: POST /auth/login
  API->>API: count the attempt (rate limit)
  API->>S: find the user, verify the Argon2id hash
  alt wrong email or wrong password
    API-->>F: 401 INVALID_CREDENTIALS (same message for both)
  else correct
    API->>S: create a new session, store only its hash
    API-->>F: 200 user + Set-Cookie (HttpOnly)
  end
```

The login attempt is counted before the password is checked. And when the email doesn't exist, the server still runs a dummy hash check, so a fast "no such user" response doesn't leak that fact.

## Where the pieces live

| Piece | Folder (TypeScript) | Folder (Go) |
| --- | --- | --- |
| Rules, no HTTP | `src/auth/core/` | `internal/auth/` |
| HTTP binding | `src/auth/express/` or `src/auth/fastify/` | `internal/ginauth/` |
| Data stores | `src/auth/stores/` | `internal/store/` |
| Your routes | `src/routes/` | `internal/routes/` |
| Settings | `src/config/selfauth.config.ts` | `selfauth.config.json` |

Every file in those folders is described on the [project structure](/structure/) pages.
