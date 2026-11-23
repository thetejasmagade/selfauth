---
title: What is SelfAuth?
description: SelfAuth writes sign-up, sign-in, sessions, roles and permissions into your own project as ordinary code you can read and change. What that means, and when it is a good fit.
keywords: [what is selfauth, code generator, authentication, authorization, self-hosted auth]
---

# What is SelfAuth?

Most apps need the same boring, risky pieces: people sign up, confirm their email, sign in, stay signed in, reset a forgotten password, and only see what they're allowed to see. Getting those right takes weeks, and getting them slightly wrong is how accounts get stolen.

SelfAuth writes those pieces for you. You run one command and it puts the code into your project: the sign-in routes, the session handling, the password hashing, the database tables and, if you want them, the sign-in pages for Vue or React.

## It's code, not a service

There's no SelfAuth server, account or API key. After `selfauth init`, the files are in your repository like any other code. You can open `src/auth/core/service.ts` and read exactly what happens when someone signs in. Your app keeps working if SelfAuth disappears tomorrow.

That also means the code is yours to look after. SelfAuth helps with that: `selfauth upgrade` brings in fixes from newer versions without overwriting the files you changed.

## What you get

- Sign-up with email verification, sign-in and sign-out
- Sessions stored in your database, in a cookie the browser's JavaScript can't read
- Password reset and password change
- Roles and permissions, checked on the server for every request
- Protection against cross-site request forgery and password guessing (rate limits)
- An admin role, plus an API for managing users and their roles
- Migrations for your database, and tests for the wiring

You choose the backend (Express, Fastify, Next.js, Gin or Flask), the database (PostgreSQL, MySQL, SQLite or MongoDB) and, optionally, a Vue, React or Next.js frontend.

## What you write yourself

SelfAuth handles *who the user is* and *what they're allowed to do*. Your app's features are still yours: the notes, orders or invoices your users work with. The guides show you how to build those on top, with your own tables, routes and permission checks.

## Is it ready?

SelfAuth is `0.x`. It has a test suite of 90 security cases that runs against every backend and database, but there has been no independent security audit yet. Have someone you trust review the code before real users depend on it. The [changelog](/resources/changelog) lists every change.

## Next

[Pick your stack](./pick-your-stack), then follow the guide for your framework. If you'd rather have an AI agent do the setup, read [Use with an AI agent](/ai/) first.
