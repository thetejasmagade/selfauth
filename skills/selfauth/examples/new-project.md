# Example: a new full-stack project

> **Developer:** Start a new orders app with login and roles. React frontend, PostgreSQL.

**1. Inspect.** `node <skill>/scripts/detect-project.ts orders-app` reports
`recommendation: init` (no `package.json`).

**2–5.** Supported: Express + PostgreSQL + React (see
[framework-support](../references/framework-support.md)). The domain suggests
the permissions `orders.view`, `orders.view_any` and `orders.create`.

**6. Plan, shown to the developer:**

```bash
selfauth init orders-app --database postgresql --frontend react \
  --permissions orders.view,orders.view_any,orders.create --dry-run
```

> I'll generate a new project in `orders-app/`: the Express API with
> SelfAuth, PostgreSQL migrations, and a React app (`server/` and `client/`, one npm workspace). Users get
> `orders.view` and `orders.create` and only see their own orders. A
> `support` role can be given `orders.view_any`. Left for you: an email
> provider and a production `DATABASE_URL`. OK to proceed?

After approval:

```bash
selfauth init orders-app --database postgresql --frontend react \
  --permissions orders.view,orders.view_any,orders.create --yes
cd orders-app && npm install && cp server/.env.example server/.env   # developer sets DATABASE_URL
selfauth db plan        # shown to the developer: one new migration, no findings
selfauth db migrate
npm run db:seed
```

**7. Integrate.** Add `server/src/routes/orders.ts`, modelled on `server/src/routes/notes.ts`: an
`ownershipPolicy` for `order`, `auth.protectedRoutes()`,
`requirePermission("orders.create")`, and `ownerFilter` in the list query.
Mount it from `server/src/routes/index.ts`. Don't touch `server/src/auth/**`.

**8. Validate.**

```bash
node <skill>/scripts/validate-auth.ts orders-app
npm run dev &   # the server, for live probes
node <skill>/scripts/validate-auth.ts orders-app --url http://localhost:3000 --protected /api/orders
```

```text
PASS    selfauth validate — server: …; client: …
PASS    selfauth doctor — 1 warning(s)
WARN    doctor warning — server: no email provider yet: implement createMailer() in src/email/mailer.ts before production
PASS    workspace: typecheck
PASS    workspace: test
PASS    workspace: build
PASS    GET /auth/me without a session — 401 UNAUTHENTICATED
PASS    POST /auth/logout without the CSRF header — 403 CSRF_FAILED
PASS    GET /api/orders without a session — 401 UNAUTHENTICATED
RESULT: PASS
```

(`workspace` is the project root's own `typecheck`, `test` and `build` scripts, which run both
`server/` and `client/`.)

**9. Report.**

```markdown
## SelfAuth integration — orders-app
**Status:** complete (backend and frontend generated, migrated, validated)
**Command run:** `selfauth init orders-app --database postgresql --frontend react --permissions orders.view,orders.view_any,orders.create --yes`
**Your files I changed:** server/src/routes/index.ts (mounts orders), server/src/routes/orders.ts (new)
**Verified:** validate-auth RESULT: PASS — validate, doctor, typecheck, test, build (server and client), live probes (/auth/me, CSRF, /api/orders)
**Not verified:** the client has no tests of its own (the generated suite covers the server's authentication wiring)
**Manual steps left:** an email provider in server/src/email/mailer.ts; production DATABASE_URL in server/.env; `npm run db:create-admin <email>` for the first admin
**Warnings from doctor:** no email provider yet
```
