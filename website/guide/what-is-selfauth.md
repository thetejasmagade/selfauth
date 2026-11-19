---
title: What is SelfAuth?
description: SelfAuth is an open-source tool that writes login, sessions and permissions code into your own project. What it does, why it exists and what it doesn't do.
keywords: [selfauth, what is, authentication generator, own your auth, code generator]
---

# What is SelfAuth?

SelfAuth writes authentication code into your project. You run one command and get registration, email verification, login, logout, password reset, roles and permissions, as ordinary files in your repository.

Once those files exist, SelfAuth is out of the picture. It doesn't run next to your app, your app doesn't import it, and nothing it generates talks to a SelfAuth server. If the CLI, npm or the project itself disappeared tomorrow, your login would keep working.

## Why bother

If you need login for an app, you usually pick one of three routes, and each has a catch.

Writing it yourself gives you full control, but auth is easy to get subtly wrong. Password hashing, session theft, account enumeration and brute-force limits all have well-known ways to go badly.

A hosted service is quick to start, but your users end up in someone else's database, you pay per user, and your login depends on their uptime and pricing.

A library is less typing, but you're tied to its choices, and an upgrade can change how your login behaves without you touching your own code.

SelfAuth is a fourth option. You get an implementation someone has already tested hard, and then it becomes yours. You can read it, change it, and keep it.

## What you get

- Registration, email verification, sign in, sign out, sign out everywhere, password change, password reset and account deletion.
- Sessions as a random token in an HttpOnly cookie. Only a hash of the token is stored in your database, and users can list and revoke their sessions.
- Roles and permissions, route guards, and per-object checks like "only the owner can read this order".
- Admin routes to suspend accounts and assign roles.
- Argon2id password hashing, rate limits, CSRF protection, and error messages that don't reveal which emails have accounts.
- Optional Vue or React pages for every account screen, with a typed API client.
- Migrations as plain SQL you can read.
- A few tests inside your project that check the wiring.

## What it doesn't do

It isn't a hosted login page, an identity provider or a single sign-on system. It doesn't do social login, magic links or multi-factor authentication yet. Only email and password works today. If something isn't in the list above, assume it isn't there, and check the [roadmap](https://github.com/thetejasmagade/selfauth/blob/main/ROADMAP.md) for what's planned.

## Two parts

There's the CLI, `selfauth`, which runs on your computer while you develop. It writes files, checks them, helps you upgrade them and runs migrations. And there's the code it generates, which runs inside your app in production. You can stop using the CLI whenever you like. The app never needs it.

## Who it's for

Anyone building an API with Express, Fastify or Gin (Go) who wants accounts they control. You don't need to have built auth before. The generated project runs on the first try, and these docs explain every file in it.

Ready to try it? The [quick start](/getting-started/quick-start) takes about ten minutes. If you'd like the big picture first, read [how it works](./how-it-works).
