---
title: How SelfAuth works
description: The architecture of SelfAuth and of the code it generates. Includes diagrams of the generator, a request through your app, and the sign-in flow.
keywords: [architecture, request lifecycle, sessions, csrf, middleware, how it works]
---

# How SelfAuth works

There are two separate worlds: **the generator** that you run once on your computer, and **the generated app** that runs in production.

## The generator

```mermaid
flowchart TB
  spec["Specification<br/>(rules every implementation must follow)"] --> ref["Reference apps<br/>(tested with 90 conformance cases)"]
  ref --> tpl["Templates<br/>(byte-for-byte copies)"]
  tpl --> cli["selfauth CLI"]
  cli -- "init / add" --> app["Your project<br/>(you own these files)"]
```

1. A **specification** describes what authentication must do and what it must never do.
2. **Reference apps** implement the specification for each framework. A **conformance suite** of 90 test cases runs against every one of them.
3. The **templates** the CLI copies are exactly those tested apps.
4. `selfauth init` writes a template into your folder and records what it wrote in `selfauth.manifest.json`.

Because the template is the tested app, there is no separate "generated version" that might behave differently.

## The generated app

A generated backend has four layers.

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

- The **core** contains all the rules and no web code. It is the same logic in every framework.
- The **adapter** turns HTTP requests into core calls and core results into HTTP responses.
- The **store** saves data. You can swap it.
- The **mailer** is yours: SelfAuth cannot know which email provider you use.

## One request, step by step

This is what happens when the browser calls a protected route such as `GET /api/orders`.

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

Three details matter:

- The cookie holds a random token, not data. Your server looks the session up on **every** request, so a revoked session stops working immediately.
- Permissions are read from the database on the server for each request. The browser cannot grant itself anything.
- Frontend checks such as hiding a button are only for convenience. The server decides.

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

The attempt is counted **before** the password is checked, and an unknown email still goes through a dummy hash check, so response time does not reveal whether an account exists.

## Where the pieces live

| Piece | Folder (TypeScript) | Folder (Go) |
| --- | --- | --- |
| Rules, no HTTP | `src/auth/core/` | `internal/auth/` |
| HTTP binding | `src/auth/express/` or `src/auth/fastify/` | `internal/ginauth/` |
| Data stores | `src/auth/stores/` | `internal/store/` |
| Your routes | `src/routes/` | `internal/routes/` |
| Settings | `src/config/selfauth.config.ts` | `selfauth.config.json` |

See [Project structure](/structure/) for every file.

## Next

- [Concepts and terms](./concepts)
