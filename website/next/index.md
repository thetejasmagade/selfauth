---
title: Next.js guide
description: Build a small notes app with Next.js and SelfAuth from start to finish. Create the project, sign in, add route handlers, permissions, an admin view, a database table with migrations, a page, tests and a production setup. Pages and API in one app.
keywords: [next.js, nextjs authentication, app router, route handlers, selfauth tutorial, notes app, next.js permissions, prisma migrations]
---

# Next.js guide

In this guide you'll build a small notes app on Next.js. People sign up, save notes and read their own. Admins can read everyone's notes. The pages and the API live in one Next.js app, the way most Next.js projects are built. It's small enough to finish in an afternoon and touches every part you'll use in a real project.

You'll learn how to:

1. [Create your project](./create-project)
2. [Run it and sign in for the first time](./run-and-sign-in)
3. [Find your way around the files](./project-tour)
4. [Add API routes: public and signed-in](./endpoints)
5. [Add permissions, and an admin-only one](./permissions)
6. [Add a table and build the notes routes](./notes)
7. [Add a page for the notes](./frontend-page)
8. [Change a table later](./change-a-table)
9. [Test your routes](./tests)
10. [Get ready for production](./production)

There's also a chapter for the other direction: [using a Next.js frontend with Express, Fastify, Gin or Flask](./with-another-backend).

Do the chapters in order. Each one builds on the last and ends with a way to check it worked.

## Before you start

You need:

- [Node.js](https://nodejs.org) 22.18 or newer (`node --version` tells you),
- a terminal.

The guide uses SQLite, which needs nothing else installed. Where PostgreSQL, MySQL or MongoDB need something different, you'll see a tab for them.

## How SelfAuth fits into Next.js

Next.js has two kinds of files that matter here. **Pages** are `page.tsx` files that draw what people see. **Route handlers** are `route.ts` files that answer HTTP requests, which is where an API lives. SelfAuth puts its code in both:

- The authentication API, `/auth/login`, `/auth/register` and the rest, is **one route handler**, `src/app/auth/[[...path]]/route.ts`, that answers every path under `/auth`.
- Your own API is more `route.ts` files, each built with a small helper, `withAuth`, that decides who may call it.
- The sign-in, sign-up and account **pages** are ordinary Next.js pages, using SelfAuth's browser module in `src/auth-client/`.

Everything is code in your project. There's no SelfAuth server to run, and nothing to call at run time.

::: tip Other ways to use Next.js with SelfAuth
- **The API only**, with your own frontend: `--frontend none`.
- **A different frontend**: `--frontend vue` or `--frontend react` puts the Next.js API in `server/` and a Vite app in `client/`.
- **Next.js as the frontend** of an Express, Fastify, Gin or Flask API: see [the last chapter](./with-another-backend).
:::

Don't know what a session or a permission is yet? [How it works](/start/how-it-works) explains the terms in five minutes.
