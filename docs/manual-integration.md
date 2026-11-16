# Manual integration (no CLI, no LLM)

SelfAuth is code you copy into your project, and every way of installing it
ends with the same files. This guide does it by hand from
[`templates/`](../templates/README.md). You can read every file before you run
anything, and nothing contacts a SelfAuth service. Requirements: Node.js ≥
22.18 and, for production, PostgreSQL.

## New project

```bash
cp -r templates/express my-app          # or express-vue / express-react
cd my-app
npm install                              # express, cookie, @node-rs/argon2, Prisma: nothing from SelfAuth
cp .env.example .env                     # set DATABASE_URL (or remove it to use the in-memory store in development)
npm run db:migrate                       # = prisma migrate deploy: review prisma/migrations/*/migration.sql first
npm run db:seed                          # writes the roles from src/selfauth.config.ts
npm run dev                              # API on :3000; emails are printed to the console
```

For `express-vue`/`express-react`, also run
`npm --prefix web install && npm run dev:web`. The Vite dev server on :5173
proxies `/auth` and `/api` to the API.

Try it:

```bash
H=(-s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' -b jar -c jar)
curl "${H[@]}" localhost:3000/auth/register -d '{"email":"me@example.com","password":"correct horse battery staple"}'
# copy the token from the verification link the server printed, then:
curl "${H[@]}" localhost:3000/auth/email/verify -d '{"token":"…"}'
curl "${H[@]}" localhost:3000/auth/login -d '{"email":"me@example.com","password":"correct horse battery staple"}'
curl "${H[@]}" localhost:3000/api/hello
```

Then make the first administrator: `npm run db:create-admin me@example.com`.

## Existing Express app

Requirements: ESM (`"type": "module"`), Express 5 (the tested version), and TypeScript
≥ 5.7.

1. **Copy the files.** Copy `templates/existing-express/src/selfauth/` to
   `src/selfauth/`, plus `selfauth.manifest.json`. For PostgreSQL, also copy
   `prisma/` and `prisma.config.ts`. If you already use Prisma, merge the
   models from `prisma/schema.prisma` into your schema by hand and create a
   reviewed migration instead of copying `prisma/`.
2. **Install the dependencies**, using the versions in
   `templates/express/package.json`:

   ```bash
   npm install express cookie @node-rs/argon2
   npm install -D typescript @types/express @types/node
   # PostgreSQL:
   npm install @prisma/client @prisma/adapter-pg pg && npm install -D prisma @types/pg
   ```
3. **Set two compiler options** in `tsconfig.json`. The code imports `.ts`
   files explicitly, and they are rewritten to `.js` on build:

   ```json
   "allowImportingTsExtensions": true,
   "rewriteRelativeImportExtensions": true
   ```
4. **Wire it in**: two lines, plus guards on your routes.

   ```ts
   import { setupSelfAuth } from "./selfauth/setup.ts";

   const app = express();
   app.use(express.json());
   const selfauth = await setupSelfAuth(app);     // before your routes
   app.get("/api/account", selfauth.auth.requireAuth, handler);
   app.use(selfauth.errorHandler);                // after your routes
   ```
5. **Configure the environment.** Set `SELFAUTH_APP_BASE_URL` (your
   frontend's URL, used in email links), plus `DATABASE_URL` for PostgreSQL.
   See `src/selfauth/env.ts`.
6. **PostgreSQL only.** Add `src/selfauth/generated/` to `.gitignore`, then
   run:

   ```bash
   npx prisma generate
   npx prisma migrate deploy
   node --env-file=.env src/selfauth/scripts/seed.ts
   ```
7. **Update your frontend.** It must send `X-SelfAuth-CSRF: 1` on POST, PUT,
   PATCH and DELETE requests. CSRF protection covers your whole app, not only
   `/auth`.

`examples/existing-express-app` and its `.selfauth.patch` show this applied
to a real app, and CI runs that app's own tests before and after.

## Before production

- **Email**: implement `createMailer()` in `mailer.ts` with your provider.
  The server refuses to start in production until you do.
- **HTTPS**: `SELFAUTH_APP_BASE_URL` must use `https://`. Cookies are
  `Secure` and `__Host-` prefixed. Behind a proxy, set `http.trustProxy`.
- **Database**: production refuses the in-memory store. Run migrations as a
  deploy step; SelfAuth never migrates on startup.
- **Secrets** belong in the environment, never in `selfauth.config.ts` or
  git. For `csrf.mode: "token"`, generate `SELFAUTH_CSRF_SECRET`:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

## Verifying a manual installation

Without the CLI:

- `npm run typecheck`, and the curl flow above;
- check that a protected route without a session returns
  `401 UNAUTHENTICATED`;
- check that a POST without `X-SelfAuth-CSRF` returns `403 CSRF_FAILED`.

With the CLI (optional, development only): `npx selfauth doctor` and
`npx selfauth validate`. The manifest you copied lets them tell you which
generated files you've changed.

## Next

- [API reference](api/README.md)
- [Database schema and migrations](database.md)
- [Customization and extension points](customization.md)
- [Upgrading](upgrading.md)
