---
title: "11. Get ready for production"
description: Take a Fastify SelfAuth project to production. Connect a real email provider, pick a production database, set the environment, run migrations as a deploy step, build and start the server, and check the result.
keywords: [production, deploy, email provider, resend, createMailer, NODE_ENV, https, migrations deploy, doctor]
---

# 11. Get ready for production

In production, SelfAuth is strict on purpose. The server refuses to start rather than run in an unsafe state: without a real email provider, without a database, or with an `http://` address. This chapter goes through each of those.

Start by asking SelfAuth what's missing:

```bash
npx selfauth doctor
```

```text
  ⚠ no email provider yet: implement createMailer() in src/email/mailer.ts before production
  • you changed 3 generated file(s): src/routes/index.ts, prisma/schema.prisma, src/config/selfauth.config.ts

0 error(s), 1 warning(s).
```

## 1. Send real email

In development, emails are printed in the terminal. In production nobody reads that terminal, so verification and password reset emails would be lost. That's why the server won't start until you connect a provider:

```text
Error: No email provider configured: implement createMailer() in src/email/mailer.ts before running in production.
```

Open `src/email/mailer.ts`. A mailer is one function that sends one message. Here's one for [Resend](https://resend.com), which needs no extra package. Any provider with an HTTP API looks much the same.

```ts
import { DevConsoleMailer, type Mailer } from "../auth/index.ts";
import type { Env } from "../config/env.ts";

export function createMailer(env: Env): Mailer {
  if (env.nodeEnv !== "production") return new DevConsoleMailer(env.nodeEnv);

  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["MAIL_FROM"]; // for example: "Notes <login@mail.example.com>"
  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY and MAIL_FROM are required in production");
  }

  return {
    async send(m) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        // m.text already holds the sentence and the link.
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        // Status only: never log the message, the link or the response body.
        throw new Error(`Resend rejected the email (HTTP ${response.status})`);
      }
    },
  };
}
```

`MAIL_FROM` must be on a domain you've verified with Resend. Send yourself a test email before real users depend on it.

## 2. Use a production database

SQLite is a single file on a single machine. That's fine for learning, but in production you'll usually want PostgreSQL (or MySQL, or MongoDB): it survives the server being replaced, and several copies of your app can share it. To switch, create a new project with `--database postgresql` and move your code across. The `src/routes/` files and your models in `schema.prisma` work as they are.

Whatever you choose, **back up the database before every migration.** There's no undo, as [chapter 8](./change-a-table) explained.

## 3. Set the environment

Set these on your hosting platform, not in a file in your repository:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production`. This turns on the strict checks and the secure cookie. |
| `DATABASE_URL` | Your production database |
| `SELFAUTH_APP_BASE_URL` | Your site's public address, starting with `https://`. Email links point here. |
| `PORT` | Whatever your host expects. Many set it for you. |
| `RESEND_API_KEY`, `MAIL_FROM` | Your email provider |

Two more things in `src/config/selfauth.config.ts`:

- **Behind a proxy or load balancer?** Almost every host puts one in front of you. Set `http.trustProxy` to `1`, so rate limits see your visitors' real addresses instead of the proxy's.
- **Frontend on a different domain from the API?** Read [Frontend deployment](/reference/frontend-deployment) first. The same-domain setup is simpler and safer.

## 4. Deploy

Each deploy runs the same steps, in this order:

```bash
npm ci                 # install exactly what's in package-lock.json
npm run build          # compile to dist/
npm run db:migrate     # apply new migrations
npm run db:seed        # write roles and permissions
npm start              # run dist/server.js
```

`npm run db:migrate` applies migrations without the safety review, so do the review *before* deploying: run `npx selfauth db plan` against a copy of the production database, or as a step in your CI. Never let the server migrate itself on start. SelfAuth's code never does, and yours shouldn't either.

After the first deploy, register your own account, verify it, and make yourself an admin with `npm run db:create-admin -- you@example.com` on the server.

## 5. Check it worked

```bash
curl -i https://notes.example.com/health        # 200 {"status":"ok"}
curl -i https://notes.example.com/api/notes     # 401 UNAUTHENTICATED
```

Then, in a browser:

1. Register with a real address and check that the email arrives.
2. Sign in, and in the developer tools check the cookie: it should be called `__Host-session`, and be `Secure` and `HttpOnly`.
3. Save a note, sign in as another user and confirm you can't see it.

## Startup errors you might meet

| Message | Fix |
| --- | --- |
| `No email provider configured` | Step 1 |
| `DATABASE_URL is required in production` | Set `DATABASE_URL` |
| `SELFAUTH_APP_BASE_URL must use https in production` | Use the `https://` address |
| `Role 'user' is missing in the database` | Run `npm run db:seed` |
| `Could not start on port 3000: … address already in use` | Something else is using the port. Set `PORT`, or stop the other program. |

## Before real users arrive

- Have someone you trust review the code: your routes especially, and the generated code if you can. SelfAuth hasn't had an independent audit yet.
- Watch for security fixes. `npx selfauth@latest diff` shows what a newer version would change, and `npx selfauth@latest upgrade` applies it without touching the files you've changed. See [upgrade](/reference/cli/upgrade).
- Keep `.env` out of git. It's already in `.gitignore`.

That's the guide. You've built and tested a small app with sign-in, permissions, an admin view and its own table. From here, the [reference](/reference/cli/) has every command, setting and error code, and [Troubleshooting](/help/troubleshooting) has the error messages people run into most.
