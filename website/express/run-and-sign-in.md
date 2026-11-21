---
title: "2. Run it and sign in"
description: Start the Express server, then register, verify the email, sign in, call a protected endpoint and sign out with curl, with the real responses.
keywords: [npm run dev, register, verify email, login, curl, session cookie, csrf header, express]
---

# 2. Run it and sign in

## Start the server

```bash
npm run dev
```

```text
Using SQLite (Prisma) store.
Listening on http://localhost:3000
```

Leave this terminal running and open a second one for the rest of the chapter. The server restarts by itself when you save a file, so you rarely need to stop it.

Check it's alive:

```bash
curl localhost:3000/health
```

```json
{"status":"ok"}
```

## Be a user for a few minutes

You'll use `curl` to do what a browser would. Two things every request needs:

- **A cookie file.** After you sign in, the server sends a session cookie. `-b jar -c jar` makes curl keep it in a file called `jar` and send it back, like a browser does.
- **The CSRF header.** Requests that change something must carry `X-SelfAuth-CSRF: 1`. It proves the request came from your own app and not from another website. [How it works](/start/how-it-works) explains why.

Rather than typing those options every time, put them in a variable:

```bash
H=(-s -H 'Content-Type: application/json' -H 'X-SelfAuth-CSRF: 1' -b jar -c jar)
```

::: tip On Windows
These commands are written for bash. The easiest way to run them on Windows is Git Bash, which comes with [Git for Windows](https://git-scm.com/download/win). In PowerShell, call `curl.exe` (not `curl`, which is a different command there) and write the options out in each command.
:::

### Register

```bash
curl "${H[@]}" localhost:3000/auth/register \
  -d '{"email":"maya@example.com","password":"correct horse battery staple"}'
```

```json
{"status":"accepted"}
```

The answer is the same whether or not the email already has an account, so nobody can use this form to find out who's registered.

### Verify the email

New accounts must confirm their email before they can sign in. Where the email shows up depends on the email setup in [chapter 1](./create-project#email-setup):

- **No provider set up (the default).** Nothing is sent. The email is printed in the terminal where the server runs. Look there:

  ```text
  Open this link to verify your email address: http://localhost:5173/verify-email#token=NQ3FSQXuhy8zERiGZZj60B6oqDKiu0KQ1F9qohuH-AQ
  ```

- **A real provider set up.** The email arrives in the inbox of the address you registered, so register with an address you can read, not the made-up `maya@example.com` used in these examples. Open the email and look for the link that ends in `#token=…`. Check your spam folder if it's slow. If nothing arrives, open your provider's dashboard: it lists every message it received and what happened to it. To go back to printing emails in the terminal, remove the provider's variables and restart the server.

Either way, the token is the part after `token=`.

Try signing in before you verify, to see what happens:

```bash
curl "${H[@]}" localhost:3000/auth/login \
  -d '{"email":"maya@example.com","password":"correct horse battery staple"}'
```

```json
{"error":{"code":"EMAIL_NOT_VERIFIED","message":"Please verify your email address before signing in.","requestId":"6c2627e4-29fc-4518-b5dd-c722dc82df2b"}}
```

Copy your own token, everything after `token=`, and send it:

```bash
curl "${H[@]}" localhost:3000/auth/email/verify -d '{"token":"PASTE_YOUR_TOKEN"}'
```

```json
{"status":"verified"}
```

### Sign in

```bash
curl "${H[@]}" localhost:3000/auth/login \
  -d '{"email":"maya@example.com","password":"correct horse battery staple"}'
```

```json
{"user":{"id":"e930577e-5e70-47cc-8c6b-cb752ca868de","email":"maya@example.com","emailVerified":true,"state":"active","roles":["user"],"permissions":[]}}
```

Maya has the `user` role, which every new account gets. Her permissions list is empty for now. You'll fill it in [chapter 5](./permissions).

### Call a protected endpoint

The project comes with one endpoint of its own, `/api/hello`, which only signed-in users may call:

```bash
curl "${H[@]}" localhost:3000/api/hello
```

```json
{"hello":"maya@example.com","database":"connected"}
```

### See the CSRF check at work

Sign out, but leave the CSRF header out on purpose:

```bash
curl -s -H 'Content-Type: application/json' -b jar -c jar -X POST localhost:3000/auth/logout
```

```json
{"error":{"code":"CSRF_FAILED","message":"Request origin could not be verified.","requestId":"e9bd2b1d-23c1-497a-ac5d-e4d37a7873de"}}
```

This check covers every `POST`, `PUT`, `PATCH` and `DELETE` in your app, including the endpoints you'll write yourself. Now sign out properly:

```bash
curl "${H[@]}" -X POST localhost:3000/auth/logout -o /dev/null -w '%{http_code}\n'
```

```text
204
```

## Check it worked

With the session gone, `/api/hello` refuses you:

```bash
curl "${H[@]}" localhost:3000/api/hello
```

```json
{"error":{"code":"UNAUTHENTICATED","message":"Authentication required.","requestId":"0234fe92-9f38-4502-9262-68b3bbd4386a"}}
```

Every error looks like this: a `code` your code can check, a `message` for people, and a `requestId` you can find in the server log. The [error codes reference](/reference/errors) lists them all.

## If something went wrong

- **`curl: (7) Failed to connect`.** The server isn't running, or it's on another port. Look at the first terminal.
- **`INVALID_CREDENTIALS`.** The email or password doesn't match. SelfAuth doesn't say which one, on purpose.
- **`RATE_LIMITED`.** You tried to sign in too many times. The limit is kept in the database, so restarting doesn't reset it. Wait 15 minutes and try again.
- **No verification email, with a provider set up.** Check spam, then your provider's dashboard for the message. A `401` or `403` from the provider is in the server's log (a wrong key, or a sender that isn't on a verified domain). The [email guide](/email/) lists the errors for each provider. To carry on without waiting, remove the provider's variables and restart: the email is printed in the terminal again.
- **`INVALID_TOKEN` when verifying.** You copied only part of the token, or used an older one. Each new registration or resend prints a new link.

Next: [Find your way around the files](./project-tour)
