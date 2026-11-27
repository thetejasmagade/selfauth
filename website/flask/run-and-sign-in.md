---
title: "2. Run it and sign in"
description: Start the Flask server, register an account, read the verification email in the terminal, verify, sign in and call a protected route with curl.
keywords: [flask run, register, verify email, login, curl, session cookie, csrf header]
---

# 2. Run it and sign in

## Start the server

```bash
python -m app.cmd.server
```

```text
Using sqlite store.
Listening on http://localhost:3000
```

Leave it running and open a second terminal for the commands below.

```bash
curl -i localhost:3000/health
```

```text
HTTP/1.1 200 OK
{"status":"ok"}
```

## Register

Sign-up is a `POST` with JSON. State-changing requests must carry the header `X-SelfAuth-CSRF: 1`, which is how SelfAuth knows the request comes from your own pages (the frontend client adds it for you).

```bash
curl -s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' \
  localhost:3000/auth/register \
  -d '{"email":"maya@example.com","password":"correct horse battery staple"}'
```

```text
{"status":"accepted"}
```

The answer is the same whether or not the address was already taken, so nobody can use sign-up to find out who has an account.

## Verify the email

Where the email shows up depends on the email setup in [chapter 1](./create-project#email-setup):

- **No provider set up (the default).** Nothing is sent. The email is printed in the terminal where the server runs. Look there:

  ```text
  [dev mail] to=maya@example.com kind=verification
  Verify your email address
  Open this link to verify your email address: http://localhost:5173/verify-email#token=eUWAyeCgb4hAtJU0YbVFuoFUUFDk37a_seIsIiX-kX8
  ```

- **A real provider set up.** The email arrives in the inbox of the address you registered, so register with an address you can read, not the made-up `maya@example.com` used in these examples. Open the email and look for the link that ends in `#token=…`. Check your spam folder if it's slow. If nothing arrives, open your provider's dashboard: it lists every message it received and what happened to it. To go back to printing emails in the terminal, remove the provider's variables and restart the server.

Either way, the token is the part after `token=`.

Send the token back:

```bash
curl -s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' \
  localhost:3000/auth/email/verify -d '{"token":"PASTE-THE-TOKEN"}'
```

```text
{"status":"verified"}
```

## Sign in and use the session

`-c jar` saves the session cookie and `-b jar` sends it back:

```bash
curl -s -c jar -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' \
  localhost:3000/auth/login \
  -d '{"email":"maya@example.com","password":"correct horse battery staple"}'
curl -s -b jar localhost:3000/auth/me
curl -s -b jar localhost:3000/api/hello
```

```text
{"user":{"id":"…","email":"maya@example.com","state":"active","roles":["user"],"permissions":[]}}
{"hello":"maya@example.com","database":"connected"}
```

`/api/hello` is the example route in `app/routes.py`. Without the cookie it answers `401`.

## If something went wrong

| What you see | Usually |
| --- | --- |
| `SELFAUTH_APP_BASE_URL is required` | `.env` is missing: copy `.env.example` to `.env` |
| `CSRF_FAILED` | The `X-SelfAuth-CSRF: 1` header is missing |
| `EMAIL_NOT_VERIFIED` | Do the verify step first |
| No email arrives, with a provider set up | Check spam, then your provider's dashboard. A rejected request is in the server's log: see the [email guide](/email/). To carry on, remove the provider's variables and restart: emails print in the terminal again |
| `role 'user' is missing in the database` | Run `python -m app.cmd.seed` |
| `could not start on port 3000` | Something else uses the port: change `PORT` in `.env` |

::: tip Does your project have a frontend?
This chapter uses curl. If you created the project with a frontend, [open it in the browser](./try-the-frontend) instead. With `--frontend none`, [connect your own frontend](./use-your-own-frontend).
:::

Next: [Find your way around](./project-tour)
