---
title: Open the frontend and try it
description: Start a project that includes a Vue, React or Next.js frontend, open it in the browser, create an account, find the verification link in the terminal, sign in and out, and reset a password.
keywords: [frontend, vue, react, next.js, localhost 5173, sign in, create account, verification link, browser, try it, run the project]
---

# Open the frontend and try it

If you created your project with `--frontend vue`, `--frontend react` or `--frontend next`, it already has working screens: create account, sign in, verify email, forgot and reset password, and an account page. This page shows how to open them and try every flow in the browser, without curl.

Created the project with `--frontend none`? You have an API only. See [Connect your own frontend](./use-your-own-frontend).

## 1. Start the project

The first time, follow the "Run" steps in the README of your project (or chapter 1 of the guide for your backend): install, copy `.env.example` to `.env`, migrate and seed. After that, one command starts everything. Run it from the top folder of the project:

```bash
npm run dev
```

This starts the API and the frontend together. Wait until both have announced themselves. With a Vue or React frontend that looks like this:

```text
[server] Listening on http://localhost:3000
[client]   ➜  Local:   http://localhost:5173/
```

Leave this terminal open. You'll need it in step 4.

## 2. Open the right address

Open the address of the **frontend**, not the API's.

| You created | Open | The API runs on |
| --- | --- | --- |
| Express, Fastify, Gin, Flask or Next.js, with `--frontend vue` or `react` | `http://localhost:5173` | `:3000`, reached through the frontend |
| Express, Fastify, Gin or Flask, with `--frontend next` | `http://localhost:5175` | `:3000`, reached through the frontend |
| Next.js with `--frontend next` | `http://localhost:3000` | the same app |

Two things catch people out here:

- **Use `localhost`, not `127.0.0.1`.** The API trusts the one address in `SELFAUTH_APP_BASE_URL` (`http://localhost:5173` by default). Open the app as `http://127.0.0.1:5173` and every sign-in fails with `CSRF_FAILED`. If you must use another address, set `SELFAUTH_APP_BASE_URL` to it in `.env` (in `server/.env` for a project with a `server/` folder) and restart.
- **`http://localhost:3000` shows an error in the first two rows.** That's the API, which has no page at its root, so it answers `{"error":{"code":"NOT_FOUND",...}}`. The pages are on the frontend's address.

## 3. Create an account

Choose **Create account** in the top bar. Enter an email address and a password of at least eight characters (the form suggests "a few unrelated words"), then submit.

The page answers:

> Check your inbox. If this address can be used, we have sent a link to finish setting up your account.

It says the same for an address that's already registered, so nobody can use the form to find out who has an account.

Try signing in right away, before you verify. It fails with "Please verify your email address first. Check your inbox for the link." That's the normal behaviour for a new account.

## 4. Find the verification link in the terminal

In development nothing is sent. The email is printed in the terminal where `npm run dev` is running:

```text
[server] [dev mail] to=maya@example.com kind=verification
[server] Verify your email address
[server] Open this link to verify your email address: http://localhost:5173/verify-email#token=…
```

Copy the whole link, including everything after `token=`, into the browser's address bar. The page confirms:

> Your email address is verified. Sign in

::: tip Using a real email provider
Once you've set up a provider, the email arrives in the inbox of the address you registered, so register with an address you can read. See [Send real email](/email/).
:::

## 5. Sign in

Choose **Sign in**, enter the same email and password. You land on the account page, which shows:

- your email address and your roles (`Roles: user` for a new account),
- a **Change password** form,
- **Signed-in devices**, one line per session with a mark on this one, and a **Sign out everywhere** button.

The top bar now shows **Account**, your email and **Sign out**.

Now open `http://localhost:5173/account` in a private window where you aren't signed in. You're sent to `/login?redirect=/account`, and after you sign in you come back to the account page. Pages that need a session are guarded like this. The API checks every request on its own too, so the guard is a convenience for your users and not what protects your data.

## 6. Sign out, and reset a password

**Sign out** takes you back to the sign-in page.

To reset a password, choose **Forgot your password?** on the sign-in page, enter your email and submit. The page says "If an account exists for that address, we have sent a link to reset the password." The terminal prints the email, with a link to `/reset-password#token=…`. Open it, choose a new password, and you'll see:

> Your password was changed and every device was signed out. Sign in

Resetting a password signs out every session on purpose, so someone who stole an old session can't keep it.

## Which screen is where

| Address | Screen | Needs a session |
| --- | --- | --- |
| `/` | Home | no |
| `/register` | Create account | no (signed-in users are redirected) |
| `/login` | Sign in | no (signed-in users are redirected) |
| `/verify-email` | Opened from the email link | no |
| `/forgot-password` | Ask for a reset link | no |
| `/reset-password` | Opened from the email link | no |
| `/account` | Password change, devices | yes |

The screens are plain on purpose, with no styling, so you can restyle them. They're your files: `client/src/pages/auth/` for Vue and React, and `src/screens/auth/` for a Next.js frontend. See the [project tour](/express/project-tour) for the folder layout.

## The first administrator

The generated screens have no admin page, because administration is done through API routes. Create the first administrator from the terminal after you've registered and verified, as described in [Permissions and roles](/express/permissions).

## If something goes wrong

| What you see | Why | What to do |
| --- | --- | --- |
| Every sign-in or sign-up ends with "Your request could not be verified. Reload the page and try again." | The address in the browser isn't the one the API trusts (`127.0.0.1`, your computer's network address, or another port). Reloading doesn't help. | Open `http://localhost:5173`, or set `SELFAUTH_APP_BASE_URL` to the address you use and restart. See [Troubleshooting](/help/troubleshooting#403-csrf_failed). |
| The page doesn't load, or `Port 5173 is already in use` | Another program holds the port. The frontend doesn't pick a different one, because the API trusts this exact address. | Stop the other program, then run `npm run dev` again. |
| No verification link in the terminal | You may have set up an email provider, so the email went to the inbox. Otherwise look for the line starting `[dev mail]` further up. | Check the inbox and spam folder, or remove the provider's variables and restart. |
| Sign-in says the email isn't verified | You haven't opened the link yet, or you used an older one. Each new sign-up or resend prints a new link. | Use the newest link in the terminal. |

Next: [add your own page](/express/frontend-page), or read the [client reference](/reference/client) to see what the generated frontend gives you.
