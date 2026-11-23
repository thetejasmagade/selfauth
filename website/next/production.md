---
title: "10. Get ready for production"
description: Take a Next.js SelfAuth project to production. Connect a real email provider, pick a production database, set the environment and the number of proxies, run migrations as a deploy step, build and start the server, and check the result.
keywords: [production, deploy, email provider, resend, createMailer, trustProxy, x-forwarded-for, next start, migrations deploy, doctor, vercel]
---

# 10. Get ready for production

In production, SelfAuth is strict on purpose. The server refuses to start rather than run in an unsafe state: without a real email provider, without a database, or with an `http://` address. This chapter goes through each of those, and through the one setting that's specific to Next.js: how SelfAuth finds out who your visitors are.

Start by asking SelfAuth what's missing:

```bash
npx selfauth doctor
```

```text
  ⚠ no email provider yet: implement createMailer() in src/email/mailer.ts before production
  • you changed 3 generated file(s): prisma/schema.prisma, src/config/selfauth.config.ts, src/app/api/notes/route.ts

0 error(s), 1 warning(s).
```

## 1. Send real email

In development, emails are printed in the terminal. In production nobody reads that terminal, so verification and password reset emails would be lost. That's why the server won't start until you connect a provider. Run `npm run build && npm start` and it stops:

```text
SelfAuth could not start: No email provider configured: implement createMailer() in src/email/mailer.ts before running in production.
```

(The process exits with status 1, so a deploy that can't start fails at once instead of looking healthy.)

Open `src/email/mailer.ts`. A mailer is one function that sends one message. Here's one for [Resend](https://resend.com), which needs no extra package. Replace the whole file with:

```ts
import { DevConsoleMailer, type Mailer } from "../auth/index.ts";
import type { Env } from "../config/env.ts";

export function createMailer(env: Env): Mailer {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["MAIL_FROM"]; // for example: "Notes <login@mail.example.com>"
  if (!apiKey) {
    if (env.nodeEnv === "production") {
      throw new Error("RESEND_API_KEY and MAIL_FROM are required in production");
    }
    return new DevConsoleMailer(env.nodeEnv); // development: print emails in the terminal
  }
  if (!from) throw new Error("MAIL_FROM is required when RESEND_API_KEY is set");

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

Resend is one choice among many. The [email providers section](/email/) has ready-made mailers for Postmark, SendGrid, Mailgun, Brevo and any SMTP server (including Amazon SES), a template for providers that aren't listed, and [a test](/email/testing) for your mailer.

## 2. Use a production database

SQLite is a single file on a single machine. That's fine for learning, but in production you'll usually want PostgreSQL (or MySQL, or MongoDB): it survives the server being replaced, and several copies of your app can share it. That matters more for Next.js than for most frameworks, because hosting platforms often run several copies of the app at once. To switch, create a new project with `--database postgresql` and move your code across. The `src/app/api/` files and your models in `schema.prisma` work as they are.

Whatever you choose, **back up the database before every migration.** There's no undo, as [chapter 8](./change-a-table) explained.

## 3. Set the environment

Set these on your hosting platform, not in a file in your repository:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Your production database |
| `SELFAUTH_APP_BASE_URL` | Your site's public address, starting with `https://`. Email links point here. |
| `PORT` | Whatever your host expects. Many set it for you. |
| `RESEND_API_KEY`, `MAIL_FROM` | Your email provider's settings (these two are for Resend, as in step 1; [other providers use other names](/reference/environment#email-provider-variables)) |

You don't set `NODE_ENV`. `next start` sets it to `production` itself, and that turns on the strict checks and the secure cookie (`__Host-session`, `Secure`, `HttpOnly`). `next dev` sets it to `development`, which is why you can sign in over plain `http://localhost` while you build.

`npm run build` needs none of these. SelfAuth starts when the server boots, not when the app is built, so you can build in a CI step that has no secrets and run the result somewhere that has them.

## 4. Tell SelfAuth how many proxies are in front of you

This is the setting that's different for Next.js. SelfAuth limits sign-in attempts per account *and* per address, and for that it needs the visitor's address. A Next.js route handler can't see the connection, so SelfAuth reads the address from the `X-Forwarded-For` header, which hosting platforms and reverse proxies set.

Open `src/config/selfauth.config.ts` and look at `http.trustProxy`. The generated value is `1`: one proxy sits in front of the app, and its address is the last entry in the header. Change it to match where you deploy:

| Where it runs | `trustProxy` |
| --- | --- |
| A hosting platform that puts its own proxy in front (Vercel, Netlify, Render, Railway, Fly.io) | `1` |
| Behind one reverse proxy of yours (nginx, Caddy, a load balancer) | `1` |
| Behind a CDN and then a reverse proxy | `2` |
| `next start` open to the internet with nothing in front | `1`, with the caveat below |

::: warning Open to the internet with no proxy
Next.js fills in `X-Forwarded-For` only when the request didn't bring one. With nothing in front of it, a visitor can send any value, so the per-address limit can be dodged by changing the header on every try. The per-account limit (five wrong passwords, then a wait) still holds, because it doesn't depend on the address. Almost every real deployment has a proxy, and a TLS terminator in front of Next.js is the normal case: you should have one anyway, because the secure cookie only works over `https`.
:::

If you set it to `false`, SelfAuth ignores the header and can't tell visitors apart: every visitor shares one per-address limit, and a handful of failed sign-ins locks everybody out for a while. It prints a warning when the server starts, and `npx selfauth doctor` warns too.

## 5. Deploy

Each deploy runs the same steps, in this order:

```bash
npm ci                 # install exactly what's in package-lock.json
npm run build          # build the app (no environment needed)
npm run db:migrate     # apply new migrations
npm run db:seed        # write roles and permissions
npm start              # run the production server
```

`npm run db:migrate` applies migrations without the safety review, so do the review *before* deploying: run `npx selfauth db plan` against a copy of the production database, or as a step in your CI. Never let the server migrate itself on start. SelfAuth's code never does, and yours shouldn't either.

On a platform that builds and runs for you, the same steps become its build command (`npm ci && npm run build`), a release or pre-deploy command (`npm run db:migrate && npm run db:seed`) and its start command (`npm start`).

After the first deploy, register your own account, verify it, and make yourself an admin with `npm run db:create-admin -- you@example.com` on the server.

::: tip SelfAuth needs the Node.js runtime
It uses native packages (password hashing, the database drivers), so it runs on the default Node.js runtime. Don't set `export const runtime = "edge"` on a route that uses `withAuth`.
:::

## 6. Check it worked

```bash
curl -i https://notes.example.com/health        # 200 {"status":"ok"}
curl -i https://notes.example.com/api/notes     # 401 UNAUTHENTICATED
```

Then, in a browser:

1. Register with a real address and check that the email arrives.
2. Sign in, and in the developer tools check the cookie: it should be called `__Host-session`, and be `Secure` and `HttpOnly`.
3. Save a note, sign in as another user and confirm you can't see it.
4. Try five wrong passwords for one account: the sixth attempt answers `RATE_LIMITED`.

## Startup errors you might meet

| Message | Fix |
| --- | --- |
| `SelfAuth could not start: No email provider configured` | Step 1 |
| `DATABASE_URL is required in production` | Set `DATABASE_URL` |
| `SELFAUTH_APP_BASE_URL must use https in production` | Use the `https://` address |
| `Role 'user' is missing in the database` | Run `npm run db:seed` |
| `Error: listen EADDRINUSE: address already in use` | Something else is using the port. Set `PORT`, or stop the other program. |
| `client addresses unknown` in the log | Step 4: set `http.trustProxy` |

## Before real users arrive

- Have someone you trust review the code: your routes especially, and the generated code if you can. SelfAuth hasn't had an independent audit yet.
- Watch for security fixes. `npx selfauth@latest diff` shows what a newer version would change, and `npx selfauth@latest upgrade` applies it without touching the files you've changed. See [upgrade](/reference/cli/upgrade).
- Keep `.env` out of git. It's already in `.gitignore`.

That's the guide. You've built and tested a small app with sign-in, permissions, an admin view, its own table and a page. From here, the [reference](/reference/cli/) has every command, setting and error code, and [Troubleshooting](/help/troubleshooting) has the error messages people run into most.
