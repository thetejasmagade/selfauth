# Architecture for agents

## What SelfAuth is

A development-time generator. `selfauth init` / `selfauth add` copy SelfAuth's
reference implementation into the project. It is the code that passes the
87-case conformance suite and the browser tests, copied byte for byte. After
that the code belongs to the project:

- No SelfAuth package is a runtime dependency, and nothing phones home.
- Runtime dependencies are ordinary libraries: `express`, `cookie` and
  `@node-rs/argon2`, plus Prisma and `pg` for PostgreSQL.
- `selfauth.manifest.json` records which files were generated, with their
  hashes, and which database objects SelfAuth owns. `validate`, `diff` and
  `upgrade` use it. Never edit it by hand.

## Layouts

### `selfauth init` (new project)

```text
src/
  auth/                 generated auth core: do not edit (see below)
    core/               hashing, sessions, tokens, rate limits, RBAC, policies
    express/index.ts    Express adapter: middleware, /auth routes, guards
    stores/             memory.ts, prisma.ts (PostgreSQL)
  config/
    selfauth.config.ts  behaviour, permissions, roles (edit this)
    env.ts, dev-config.ts
  routes/
    index.ts            the application's routes (edit; mounts the notes example)
    notes.ts            example of guards, ownership and list filtering
  email/mailer.ts       email delivery (replace the dev mailer)
  db/store.ts           chooses the data store (PostgreSQL or in-memory)
  http/                 errors.ts, request-id.ts
  app.ts, server.ts     the Express app and the entry point
  scripts/seed.ts, scripts/create-admin.ts    (PostgreSQL)
prisma/schema.prisma, prisma/migrations/      (PostgreSQL)
web/                    (--frontend vue|react) API client, session state,
                        route guards, <Can>, every auth page
```

With `--frontend vue|react`, `init` makes two packages in one npm workspace
instead: everything above (except `web/`) moves into `server/`, the frontend
becomes `client/`, and the root holds `package.json` (workspaces, `npm run dev`
starts both), `README.md`, `.gitignore`, and `selfauth.config.json`: the
browser-safe settings (the password length limits) that the server and the
frontend share. Each package imports a copy of it inside its own folder, which
`npm run sync` writes (`dev`, `build`, `test` and `typecheck` run it first), so
the build, tsconfig and Vite need no special setup. Each package has its own
`selfauth.manifest.json`, so run `selfauth doctor`, `validate`, `diff` and
`upgrade` at the root (they cover both) or inside a package.

```text
server/   package.json, tsconfig*.json, .env.example, src/ (as above), test/, prisma/
client/   package.json, vite.config.ts, src/auth/ (API client, guards), src/pages/
```

### `selfauth add` (existing Express project)

Everything goes under `src/selfauth/`, plus `prisma/` for PostgreSQL, so
nothing collides with the application's files. The CLI never edits existing
files. The agent makes the wiring edits, and only with the developer's
approval:

```text
src/selfauth/auth/**          generated auth core: do not edit
src/selfauth/setup.ts         setupSelfAuth(app): the single entry point
src/selfauth/config/   selfauth.config.ts, env.ts, dev-config.ts
src/selfauth/email/mailer.ts, db/store.ts, http/ (errors.ts, request-id.ts)
```

## Which files to edit

| File | Edit? |
| --- | --- |
| `config/selfauth.config.ts` | Yes. Permissions, roles, timeouts and CSRF mode. Validated against the spec's bounds at startup, so invalid or insecure values fail fast. |
| `email/mailer.ts` | Yes, to connect a real email provider. It must not log tokens (SEC-LOG-001). |
| `routes/` | Yes. This is application code. |
| `db/store.ts`, `config/env.ts`, `server.ts`, `app.ts`, `setup.ts` | Only when needed, for example extra environment variables. Keep the order of middleware. |
| `auth/**` | No, unless the developer explicitly asks. This is the security core. Edits show up in `selfauth validate` and make `upgrade` write proposals instead of updates. |
| `prisma/migrations/*` already applied | Never. Add new migrations instead. |

## Integrating with application code

`auth` is the object from `createAuth()`. In the add layout it is
`selfauth.auth` from `setupSelfAuth(app)`.

```ts
// Wiring (add layout): SelfAuth middleware before the app's routes, its error handler after them.
import { setupSelfAuth } from "./selfauth/setup.ts";
const selfauth = await setupSelfAuth(app);
const { auth } = selfauth;

// Require a session
app.get("/api/me/orders", auth.requireAuth, handler);

// Require a permission. It must be declared in selfauth.config.ts (an unknown name throws at startup).
app.post("/api/orders", auth.requirePermission("orders.create"), handler);

// Ownership: register a policy that loads the resource server-side
auth.policies.register(
  "order",
  ownershipPolicy(async (id) => {
    const o = await db.order.find(id);
    return o ? { type: "order", id: o.id, ownerId: o.userId } : null;
  }),
);
app.get(
  "/api/orders/:id",
  auth.authorizeResource("orders.view", (req) => ({ type: "order", id: req.params.id })),
  handler,
);

// Lists: filter in the query, never after fetching (AUTHZ-RES-006)
const filter = ownerFilter(auth.context(res)!, "orders.view"); // { ownerId } or null with orders.view_any

// Deny-by-default router: a route without a guard is refused (AUTHZ-CORE-001)
const routes = auth.protectedRoutes();
routes.get("/", auth.requirePermission("orders.view"), handler);
app.use("/api/orders", routes.router);

app.use(selfauth.errorHandler); // last
```

`ownershipPolicy` and `ownerFilter` are exported from the auth index:
`./selfauth/auth/index.ts` in the add layout, `./auth/index.ts` otherwise.
`auth.context(res)` returns the session context (`userId`, `roles`,
`permissions`, `user`, `session`) or `null`.

### Permissions and roles

```ts
authorization: {
  permissions: ["orders.view", "orders.view_any", "orders.create"],
  roles: { user: ["orders.view", "orders.create"], support: ["orders.view_any"], admin: [] },
  defaultRoles: ["user"],
}
```

- Names are `resource.action`. A `*_any` variant bypasses ownership.
- `admin` always holds the system permissions (`auth.users.manage` and the
  others). Registration never grants roles beyond `defaultRoles`. Create the
  first admin with `npm run db:create-admin <email>`, or with
  `node --env-file=.env src/selfauth/scripts/create-admin.ts <email>` in the
  add layout. It needs PostgreSQL (AUTHZ-ADMIN-005).
- With PostgreSQL, roles live in the database: run the seed after changing
  them.

### Frontend

- Send cookies (`credentials: "include"`, or same-origin through a proxy).
- Send `X-SelfAuth-CSRF: 1` on every unsafe method. In `token` mode, send the
  `csrfToken` from login or `/auth/me` instead.
- Email links go to frontend pages `/verify-email#token=…` and
  `/reset-password#token=…`. Those pages POST the token. Keep it in the
  fragment (SEC-TOKEN-005).
- Permission checks in the UI are hints only. The backend must enforce every
  one (AUTHZ-CORE-004).
- Cross-site deployments (API on a different site) need `sameSite: "none"`
  and token-mode CSRF. See `docs/frontend-deployment.md` in the SelfAuth
  repository.

## HTTP routes (default prefix `/auth`)

`POST register`, `POST login`, `POST logout`, `POST logout-all`, `GET me`,
`GET sessions`, `DELETE sessions/:id`, `POST email/verification`,
`POST email/verify`, `POST password/change`, `POST password/reset-request`,
`POST password/reset`, `POST account/delete`, plus admin routes under
`admin/users/:id/...`. Errors always use
`{ "error": { "code", "message", "requestId" } }`. Clients must branch on
`code`, never on `message`.
