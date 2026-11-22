---
title: "2. Run it and sign in"
description: Start the Next.js app, then register, verify the email, sign in, call a protected route and sign out, in the browser and with curl, with the real responses.
keywords: [npm run dev, register, verify email, login, curl, session cookie, csrf header, next.js]
---

# 2. Run it and sign in

## Start the app

```bash
npm run dev
```

```text
▲ Next.js 16.4.6 (Turbopack)
- Local:         http://localhost:3000
- Environments: .env
✓ Ready in 301ms
Using SQLite (Prisma) store.
```

Leave this terminal running and open a second one for the rest of the chapter. Next.js reloads by itself when you save a file, so you rarely need to stop it.

::: tip SelfAuth starts with the server
The last line comes from SelfAuth. It starts when the server boots, so a mistake in your settings (a missing `SELFAUTH_APP_BASE_URL`, a database that isn't there) stops the server at once with a clear message, instead of failing on the first sign-in. The one thing to know: after you change `src/auth/` or `selfauth.config.ts`, stop `npm run dev` and start it again. Changes to your own route files and pages reload on their own.
:::

Check it's alive:

```bash
curl localhost:3000/health
```

```json
{"status":"ok"}
```

## Sign in with the browser

Open `http://localhost:3000`. Choose **Create account**, enter an email and a password of at least eight characters, and submit. The page tells you to check your email.

Nothing was sent. In development the email is printed in the terminal where `npm run dev` runs:

```text
[dev mail] to=maya@example.com kind=verification
Verify your email address
Open this link to verify your email address: http://localhost:3000/verify-email#token=EXAMPLE-ONLY-this-is-not-a-real-token-0000000000
```

Open that link in the browser. It says your email is verified. Now **Sign in**. You'll land on a page that shows your email in the header and a **Sign out** button.

The rest of this chapter does the same with `curl`, which shows what's happening underneath. You can skip to the [next chapter](./project-tour) if you'd rather not.

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

- **No provider set up (the default).** Nothing is sent. The email is printed in the terminal where the server runs. Look there for the link ending in `#token=…`.
- **A real provider set up.** The email arrives in the inbox of the address you registered, so register with an address you can read, not the made-up `maya@example.com` used in these examples. Check your spam folder if it's slow. If nothing arrives, open your provider's dashboard: it lists every message it received and what happened to it. To go back to printing emails in the terminal, remove the provider's variables and restart the server.

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
{"user":{"id":"cd6b5786-4f89-473c-b872-02f70b6c74ff","email":"maya@example.com","emailVerified":true,"state":"active","roles":["user"],"permissions":[]}}
```

Maya has the `user` role, which every new account gets. Her permissions list is empty for now. You'll fill it in [chapter 5](./permissions).

### Call a protected route

The project comes with one route of its own, `/api/hello`, which only signed-in users may call:

```bash
curl "${H[@]}" localhost:3000/api/hello
```

```json
{"hello":"maya@example.com","database":"connected"}
```

Without the cookie it's refused:

```bash
curl -s localhost:3000/api/hello
```

```json
{"error":{"code":"UNAUTHENTICATED","message":"Authentication required.","requestId":"a4dae9d4-d25f-47c9-a9ed-c1f0f12f3249"}}
```

Every error SelfAuth sends has this shape. Your code can read `code` and never needs to parse the `message`.

### Sign out

```bash
curl "${H[@]}" -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/auth/logout
```

```text
204
```

The session is ended on the server, so the cookie is useless from now on, even if somebody copied it.

## Check it worked

You should have seen all of this:

- `/health` answers `{"status":"ok"}`.
- Registering answers `accepted`, and signing in before verifying answers `EMAIL_NOT_VERIFIED`.
- After verifying, signing in answers with your user.
- `/api/hello` answers with your email when you're signed in, and `UNAUTHENTICATED` when you're not.

## If something went wrong

- **The page says "Loading…" and nothing else.** The page asks the server who you are, and the server isn't answering. Check the terminal where `npm run dev` runs for an error.
- **`CSRF_FAILED`.** The request left out `X-SelfAuth-CSRF: 1`, or came from a different address than `SELFAUTH_APP_BASE_URL`. If you open the app on another port, set that variable to match.
- **`INVALID_CREDENTIALS`.** The email or the password is wrong. SelfAuth never says which.
- **`RATE_LIMITED`.** Too many tries in a short time. Wait for the window to pass (15 minutes by default; the limits are in `selfauth.config.ts`).

Next: [Find your way around](./project-tour)
