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
> SelfAuth, PostgreSQL migrations, and a React app in `web/`. Users get
> `orders.view` and `orders.create` and only see their own orders. A
> `support` role can be given `orders.view_any`. Left for you: an email
> provider and a production `DATABASE_URL`. OK to proceed?

After approval:

```bash
selfauth init orders-app --database postgresql --frontend react \
  --permissions orders.view,orders.view_any,orders.create --yes
cd orders-app && npm install && cp .env.example .env   # developer sets DATABASE_URL
selfauth db plan        # shown to the developer: one new migration, no findings
selfauth db migrate
npm run db:seed
npm --prefix web install
```

**7. Integrate.** Add `src/orders.ts`, modelled on `src/example/notes.ts`: an
`ownershipPolicy` for `order`, `auth.protectedRoutes()`,
`requirePermission("orders.create")`, and `ownerFilter` in the list query.
Mount it from `src/routes.ts`. Don't touch `src/auth/**`.

**8. Validate.**

```bash
node <skill>/scripts/validate-auth.ts orders-app
npm run dev &   # the server, for live probes
node <skill>/scripts/validate-auth.ts orders-app --url http://localhost:3000 --protected /api/orders
```

```text
PASS    selfauth validate — …
PASS    selfauth doctor — 1 warning(s)
WARN    doctor warning — no email provider yet: implement createMailer() in src/mailer.ts before production
PASS    backend: typecheck
SKIPPED backend: test — no "test" script in package.json
PASS    backend: build
PASS    web: typecheck
PASS    web: build
PASS    GET /auth/me without a session — 401 UNAUTHENTICATED
PASS    POST /auth/logout without the CSRF header — 403 CSRF_FAILED
PASS    GET /api/orders without a session — 401 UNAUTHENTICATED
RESULT: PASS — 2 check(s) SKIPPED: not verified, report them
```

**9. Report.**

```markdown
## SelfAuth integration — orders-app
**Status:** complete (backend and frontend generated, migrated, validated)
**Command run:** `selfauth init orders-app --database postgresql --frontend react --permissions orders.view,orders.view_any,orders.create --yes`
**Your files I changed:** src/routes.ts (mounts orders), src/orders.ts (new)
**Verified:** validate-auth RESULT: PASS — validate, doctor, typecheck, build (backend and web), live probes (/auth/me, CSRF, /api/orders)
**Not verified:** there are no project tests yet (no "test" script); web tests were skipped for the same reason
**Manual steps left:** an email provider in src/mailer.ts; production DATABASE_URL; `npm run db:create-admin <email>` for the first admin
**Warnings from doctor:** no email provider yet
```
