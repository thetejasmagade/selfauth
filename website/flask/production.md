---
title: "9. Get ready for production"
description: Take a Flask SelfAuth project to production. Connect a real email provider, pick a production database, set the environment, run migrations as a deploy step, start the server and check the result.
keywords: [production, deploy, email provider, resend, create_mailer, APP_ENV, https, migrations, doctor, waitress, gunicorn]
---

# 9. Get ready for production

In production, SelfAuth is strict on purpose. The server refuses to start rather than run in an unsafe state: without a real email provider, without a database, or with an `http://` address. This chapter goes through each of those.

Start by asking SelfAuth what's missing:

```bash
npx selfauth doctor
```

```text
  ⚠ no email provider yet: implement create_mailer in app/mailer.py before production
0 error(s), 1 warning(s).
```

## 1. Send real email

In development, emails are printed in the terminal. In production nobody reads that terminal, so the server won't start until you connect a provider:

```text
RuntimeError: no email provider configured: implement create_mailer in app/mailer.py before running in production.
```

Open `app/mailer.py` and replace it with the mailer for your provider. [Send email with Resend](/email/resend) has complete, tested Python code; [other providers](/email/other-providers) have a template, and [a test](/email/testing) for your mailer. Send yourself a test email before real users depend on it.

## 2. Use a production database

SQLite is a single file on a single machine. In production you'll usually want PostgreSQL (or MySQL, or MongoDB): it survives the server being replaced, and several copies of your app can share it. To switch, create a new project with `--database postgresql` and move your code across. Your routes work as they are; only the SQL in your own migrations needs the tab for the new database.

Whatever you choose, **back up the database before every migration.** There's no undo.

## 3. Set the environment

Set these on your hosting platform, not in a file in your repository:

| Variable | Value |
| --- | --- |
| `APP_ENV` | `production`. This turns on the strict checks and the secure cookie. |
| `DATABASE_URL` | Your production database |
| `SELFAUTH_APP_BASE_URL` | Your site's public address, starting with `https://`. Email links point here. |
| `PORT` | Whatever your host expects. Many set it for you. |
| `RESEND_API_KEY`, `MAIL_FROM` | Your email provider's settings (these two are for Resend) |

Two more things in `selfauth.config.json`:

- **Behind a proxy or load balancer?** Almost every host puts one in front of you. Set `http.trustProxy` to `1`, so rate limits see your visitors' real addresses instead of the proxy's.
- **Frontend on a different domain from the API?** Read [Frontend deployment](/reference/frontend-deployment) first. The same-domain setup is simpler and safer.

## 4. Deploy

Each deploy runs the same steps, in this order:

```bash
pip install -r requirements.txt     # install what the server needs
python -m app.cmd.migrate up        # apply new migrations
python -m app.cmd.seed              # write roles and permissions
python -m app.cmd.server            # start the server
```

`python -m app.cmd.server` runs Waitress, a production-grade server. If your platform prefers its own, any WSGI server runs the app: `gunicorn app.wsgi:app` or `waitress-serve app.wsgi:app`. Review migrations with `npx selfauth db plan` against a copy of the production database (or as a CI step) *before* deploying. Never let the server migrate itself on start. SelfAuth's code never does, and yours shouldn't either.

After the first deploy, register your own account, verify it, and make yourself an admin with `python -m app.cmd.create_admin you@example.com` on the server.

## 5. Check it worked

```bash
curl -i https://notes.example.com/health        # 200 {"status":"ok"}
curl -i https://notes.example.com/api/notes     # 401 UNAUTHENTICATED
```

Then, in a browser: register with a real address and check the email arrives; sign in and check the cookie is called `__Host-session` and is `Secure` and `HttpOnly`; save a note, sign in as another user and confirm you can't see it.

## Startup errors you might meet

| Message | Fix |
| --- | --- |
| `no email provider configured` | Step 1 |
| `DATABASE_URL is required in production` | Set `DATABASE_URL` |
| `the application base URL must use https in production` | Use the `https://` address |
| `role 'user' is missing in the database` | Run `python -m app.cmd.seed` |
| `could not start on port 3000` | Something else is using the port. Set `PORT`, or stop the other program. |

## Before real users arrive

- Have someone you trust review the code: your routes especially, and the generated code if you can. SelfAuth hasn't had an independent audit yet.
- Watch for security fixes. `npx selfauth@latest diff` shows what a newer version would change, and `npx selfauth@latest upgrade` applies it without touching the files you've changed.
- Keep `.env` out of git. It's already in `.gitignore`.

That's the guide. You've built and tested a small app with sign-in, permissions, an admin view and its own table. From here, the [reference](/reference/cli/) has every command, setting and error code.
