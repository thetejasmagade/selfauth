---
title: Going to production
description: A checklist for deploying a SelfAuth project safely. HTTPS, a real database and migrations, a real email provider, environment variables, proxies, doctor checks, build and run commands for Node and Go.
keywords: [production, deploy, checklist, https, hsts, build, NODE_ENV production, doctor, migrations, docker, trustProxy]
---

# Going to production

Use this page as a checklist. Production mode adds **strict startup checks on purpose**: the server refuses to start rather than run unsafely.

## 1. Run the checks

```bash
npx selfauth validate
npx selfauth doctor
```

Fix every error and read every warning. The warnings that matter most are listed below.

## 2. Checklist

| # | Item | Why | How |
| --- | --- | --- | --- |
| 1 | **A real database** | The in-memory store loses data and is refused in production | Set `DATABASE_URL`, run migrations and the seed |
| 2 | **Migrations applied as a deploy step** | The server never migrates itself | `npx selfauth db plan` then `npx selfauth db migrate`, then `npm run db:seed` |
| 3 | **A real email provider** | The server refuses to start until `createMailer` / `NewMailer` is implemented | [Send real email](/build/email) |
| 4 | **HTTPS everywhere** | Cookies are `Secure`; `SELFAUTH_APP_BASE_URL` must be `https://` | Terminate TLS at your proxy or host |
| 5 | **Production environment variable** | Turns on the strict checks and the production cookie name | `NODE_ENV=production` (Gin: `APP_ENV=production`) |
| 6 | **Correct app address** | Email links and CSRF trust come from it | `SELFAUTH_APP_BASE_URL=https://app.example.com` |
| 7 | **Trust your proxy** | Rate limits need real client addresses | `http.trustProxy: 1` (hops) when behind one proxy |
| 8 | **CSRF secret** (cross-site only) | Token mode needs it | `SELFAUTH_CSRF_SECRET`, 32+ random bytes |
| 9 | **First administrator** | Cannot be made through the API | `npm run db:create-admin you@example.com` |
| 10 | **Secrets out of git** | `.env` must never be committed | Set variables in your platform |
| 11 | **Backups** | There are no down migrations | Take a backup before every migration |
| 12 | **HSTS** | Prevents downgrade to http | `Strict-Transport-Security: max-age=31536000; includeSubDomains` at your proxy, once every subdomain serves HTTPS |
| 13 | **Review** | No independent audit exists yet | Have your own reviewer look at the code and your routes |

## 3. Build and run

### Express and Fastify

```bash
npm ci
npm run build          # compiles src/ to dist/
npm run db:migrate     # deploy step
npm run db:seed        # deploy step
NODE_ENV=production npm start
```

`npm start` runs `node dist/server.js`. In a full-stack project, `npm run build` also builds the client into `client/dist/`: serve those static files from your web server or CDN, and proxy `/auth` and `/api` to the API ([same origin](/configuration/frontend-deployment)).

The `postinstall` script runs `prisma generate`, so install with scripts enabled (the default). The generated client is not committed.

### Gin

```bash
go build -o bin/server ./cmd/server
go run ./cmd/migrate up          # or build ./cmd/migrate too
go run ./cmd/seed
APP_ENV=production ./bin/server
```

The server must run **in the folder that holds `selfauth.config.json`**, or you set `SELFAUTH_CONFIG` to its path. Copy that file into your deployment.

### A container

A minimal Node example (adapt it to your platform; this is illustrative and was not run):

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
CMD ["npm", "start"]
```

Run migrations and the seed as a separate release step, not in `CMD`.

## 4. Verify the deployment

```bash
curl -i https://app.example.com/health          # 200 {"status":"ok"}
curl -i https://app.example.com/api/hello       # 401 UNAUTHENTICATED
```

Then register with a real address, check that the verification email arrives, sign in, and check that the cookie shows `Secure` and `HttpOnly` in the browser's developer tools.

## Startup errors you may meet

| Message | Meaning |
| --- | --- |
| `DATABASE_URL is required in production; the in-memory store loses all data on restart.` | Set `DATABASE_URL` |
| `No email provider configured: implement createMailer() ...` | [Send real email](/build/email) |
| `SELFAUTH_APP_BASE_URL must use https in production` | Use an `https://` address |
| `authentication.sessions.cookie.secure must be true in production` | Do not set `secure: false` outside localhost |
| `Role 'user' is missing in the database. Run the migrations and npm run db:seed first.` | Run the seed |

## Operations

- **Logs** are JSON lines with a `requestId`. Forward them to your log system; they contain no secrets.
- **Security events** are in `auth_security_events`: forward or query them for monitoring. Plan their [retention](./data-retention).
- **Upgrades:** follow [`diff` and `upgrade`](/cli/upgrade). Subscribe to security advisories for the repository.
- **Scaling:** use PostgreSQL (or MySQL or MongoDB) when running several instances, so rate limits are shared. SQLite and the in-memory store are single-process.

## Next

- [Existing projects](./existing-projects)
