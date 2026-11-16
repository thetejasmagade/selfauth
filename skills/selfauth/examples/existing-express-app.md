# Example: an existing Express app that already has some auth

> **Developer:** Add proper login to my API.

**1. Inspect.**

```text
**Recommendation: add** — Existing Express project: `selfauth add` writes new files under src/selfauth/ only.
- Existing auth packages: jsonwebtoken
## Authentication code already in the application
- src/middleware/auth.ts:8 (JWT sign/verify): `const payload = jwt.verify(token, process.env.JWT_SECRET!);`
- src/routes/admin.ts:3 (bearer token): `// expects Authorization: Bearer <token>`
## Options
- available: `selfauth add --database memory --allow-existing-auth`
- BLOCKED: `selfauth add --database postgresql --allow-existing-auth`
  - blocker: this project already uses Prisma: merging SelfAuth's models into an existing schema is not automated yet. …
```

**3. Existing auth: stop and ask.**

> Your API already verifies JWTs (`src/middleware/auth.ts:8`) for the admin
> routes. SelfAuth would add cookie sessions and `/auth/*` routes *next to*
> that. It does not remove or change your JWT code. Your project uses Prisma,
> and merging SelfAuth's tables into your schema isn't automated yet, so the
> supported option today is the in-memory store. That's for trying it out
> only; it isn't for production. How would you like to proceed?
>
> 1. Add SelfAuth (in-memory) next to the JWT auth, to evaluate it.
> 2. Stop here.

The developer picks 1. Only now pass `--allow-existing-auth`.

**6. Plan.** Run `selfauth add --database memory --allow-existing-auth
--dry-run` and show the file list (all under `src/selfauth/`). Then list
*your* edits:

- `tsconfig.json`: add `allowImportingTsExtensions` and
  `rewriteRelativeImportExtensions`.
- `src/server.ts`: `setupSelfAuth(app)` before the routes, and
  `selfauth.errorHandler` after them.
- The frontend's `fetch` wrapper: send `X-SelfAuth-CSRF: 1` on unsafe
  methods. CSRF protection now covers the whole app, including the existing
  JWT routes.

After approval:

```bash
selfauth add --database memory --allow-existing-auth --yes --install
```

**8. Validate.** `validate-auth.ts --url … --protected /api/account` passes.
The existing test suite (`npm test`) also passes, which shows the JWT routes
still work.

**9. Report.** Include, under *Not supported / not done*, that the store is
in-memory because the project's Prisma schema wasn't merged. Persisting
users needs a manual schema merge or a later SelfAuth release. Also include
that the JWT auth was left as it was, at the developer's request.
