---
title: What is SelfAuth?
description: SelfAuth is an open-source development-time tool that generates authentication and authorization code inside your own application. Learn what it is, why it exists and what it does not do.
keywords: [selfauth, what is, authentication generator, own your auth, code generator]
---

# What is SelfAuth?

SelfAuth is a **code generator for authentication and authorization**. You run one command, and it writes the files that let people register, verify their email, sign in, sign out, reset a password and be given roles and permissions. The files go **into your project**, in your repository.

After that, SelfAuth is finished. It is not running next to your app, it is not a package your app imports, and it does not talk to any server.

> Generate it. Own it. Modify it. Deploy it.

## Why it exists

Most teams pick one of three ways to get login:

| Option | What you get | What you give up |
| --- | --- | --- |
| Write it yourself | Full control | It is easy to get wrong. Password hashing, session theft, account enumeration and rate limits are all places to make a security mistake. |
| Use a hosted service (an identity provider) | Fast start | Your users live in someone else's database. You pay per user. If the service changes or disappears, your login breaks. |
| Use an auth library | Less code to write | You depend on the library's choices, and upgrades can change behavior underneath you. |

SelfAuth takes a fourth path: **a tested, secure implementation, copied into your project.** You get the speed of a ready-made solution and you still own every line.

## What problems it solves

- You do not want your users' accounts in a third-party service.
- You want the authentication code to be readable and changeable.
- You want security decisions (hashing cost, session length, cookie flags) as plain configuration with safe defaults.
- You want the same behavior on more than one framework or database.

## What you get

- **Account lifecycle:** register, verify email, sign in, sign out, sign out everywhere, change password, reset password, delete account.
- **Sessions:** a random token in an `HttpOnly` cookie. Only its hash is stored in your database. You can list and revoke sessions.
- **Authorization:** roles and permissions (RBAC), route guards, and per-resource checks such as "only the owner of an order may read it".
- **Administration:** suspend or disable accounts, assign roles, with a recent-password requirement.
- **Protection:** Argon2id hashing, rate limits, CSRF defense, identical responses that do not reveal which emails exist, redacted logs, a security event log.
- **Optional frontend:** Vue 3 or React pages for every account screen, a typed API client, route guards and a `<Can>` component.
- **Database migrations** you can read, as plain SQL.
- **Tests inside your project** that check the wiring.

## What it is not

SelfAuth does **not** provide:

- a hosted login page or identity provider;
- single sign-on across separately deployed apps;
- social login (Google, GitHub) or magic links. Only email and password is implemented today;
- multi-factor authentication. This is not implemented today;
- a user dashboard;
- billing.

Anything not listed under "What you get" should be treated as not implemented. See the [roadmap](https://github.com/thetejasmagade/selfauth/blob/main/ROADMAP.md) for what is planned.

## The two parts

| Part | What it is | When it runs |
| --- | --- | --- |
| The **CLI** (`selfauth`) | Writes files, checks them, helps upgrade them and runs migrations | On your computer, during development |
| The **generated code** | Your authentication, in your repository | Inside your app, in production |

The CLI is optional once the project exists. The app never needs it to run.

## Who it is for

SelfAuth fits you if you build an API with **Express, Fastify or Gin** (Go) and want accounts that you control. It is aimed at people who have never built authentication before, as much as at experienced developers: the generated project works on the first run, and the guides here explain every file.

## Next

- [How it works](./how-it-works)
- [Quick start](/getting-started/quick-start)
