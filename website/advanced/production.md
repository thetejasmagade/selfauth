---
title: Going to production
description: A checklist for deploying a SelfAuth project safely. HTTPS, a real database and migrations, a real email provider, environment variables, proxies, doctor checks, build and run commands for Node and Go.
keywords: [production, deploy, checklist, https, hsts, build, NODE_ENV production, doctor, migrations, docker, trustProxy]
---

# Going to production

Treat this page as a checklist. Production mode adds strict startup checks, and the server would rather refuse to start than run in an unsafe state.

## 1. Run the checks

```bash
npx selfauth validate
npx selfauth doctor
```

Fix every error and read every warning. The ones that matter most are in the checklist below.

## 2. Checklist

| # | Item | Why | How |
| --- | --- | --- | --- |
| 1 | A real database | The in-memory store loses data and is refused in production | Set `DATABASE_URL`, run migrations and the seed |
| 2 | Migrations applied as a deploy step | The server never migrates itself | `npx selfauth db plan` then `npx selfauth db migrate`, then `npm run db:seed` |
| 3 | A real email provider | The server refuses to start until `createMailer` / `NewMailer` is implemented | [Send real email](/build/email) |
| 4 | HTTPS everywhere | Cookies are `Secure`; `SELFAUTH_APP_BASE_URL` must be `https://` | Terminate TLS at your proxy or host |
| 5 | Production environment variable | Turns on the strict checks and the production cookie name | `NODE_ENV=production` (Gin: `APP_ENV=production`) |
| 6 | Correct app address | Email links and CSRF trust come from it | `SELFAUTH_APP_BASE_URL=https://app.example.com` |
| 7 | Trust your proxy | Rate limits need real client addresses | `http.trustProxy: 1` (hops) when behind one proxy |
| 8 | CSRF secret (cross-site only) | Token mode needs it | `SELFAUTH_CSRF_SECRET`, 32+ random bytes |
| 9 | First administrator | Cannot be made through the API | `npm run db:create-admin you@example.com` |
| 10 | Secrets out of git | `.env` must never be committed | Set variables in your platform |
| 11 | Backups | There are no down migrations | Take a backup before every migration |
| 12 | HSTS | Prevents downgrade to http | `Strict-Transport-Security: max-age=31536000; includeSubDomains` at your proxy, once every subdomain serves HTTPS |
| 13 | Review | No independent audit exists yet | Have your own reviewer look at the code and your routes |

## 3. Build and run

### Express and Fastify

```bash
npm ci
npm run build          # compiles src/ to dist/
npm run db:migrate     # deploy step
npm run db:seed        # deploy step
NODE_ENV=production npm start
```

`npm start` runs `node dist/server.js`. In a full-stack project, `npm run build` also builds the client into `client/dist/`. Serve those static files from your web server or a CDN and proxy `/auth` and `/api` to the API ([same origin](/configuration/frontend-deployment)).

The `postinstall` script runs `prisma generate`, so install with scripts enabled, which is the default. The generated client isn't committed.

### Gin

```bash
go build -o bin/server ./cmd/server
go run ./cmd/migrate up          # or build ./cmd/migrate too
go run ./cmd/seed
APP_ENV=production ./bin/server
```

Run the server from the folder that holds `selfauth.config.json`, or set `SELFAUTH_CONFIG` to its path. Remember to copy that file into your deployment.

### A container

A minimal Node example. Adapt it to your platform, since I haven't run this one:

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

Run migrations and the seed as a separate release step, not inside `CMD`.

## 4. Verify the deployment

```bash
curl -i https://app.example.com/health          # 200 {"status":"ok"}
curl -i https://app.example.com/api/hello       # 401 UNAUTHENTICATED
```

Then register with a real address, check that the verification email arrives, sign in, and confirm in the browser's developer tools that the cookie is `Secure` and `HttpOnly`.

## Startup errors you may meet

| Message | Meaning |
| --- | --- |
| `DATABASE_URL is required in production; the in-memory store loses all data on restart.` | Set `DATABASE_URL` |
| `No email provider configured: implement createMailer() ...` | [Send real email](/build/email) |
| `SELFAUTH_APP_BASE_URL must use https in production` | Use an `https://` address |
| `authentication.sessions.cookie.secure must be true in production` | Do not set `secure: false` outside localhost |
| `Role 'user' is missing in the database. Run the migrations and npm run db:seed first.` | Run the seed |

## Operations

- Logs are JSON lines with a `requestId`. Send them to your log system. They contain no secrets.
- Security events are in `auth_security_events`. Forward or query them for monitoring, and decide how long to keep them ([retention](./data-retention)).
- For upgrades, follow [`diff` and `upgrade`](/cli/upgrade), and subscribe to security advisories for the repository.
- To run several instances, use PostgreSQL (or MySQL or MongoDB) so rate limits are shared. SQLite and the in-memory store are single process.
