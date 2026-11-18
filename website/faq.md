---
title: Frequently asked questions
description: Answers about SelfAuth - what it is, whether it is secure and production-ready, which stacks it supports, how to add social login or MFA, licensing, upgrades, and how it differs from hosted auth providers.
keywords: [faq, questions, is selfauth production ready, social login, mfa, license, auth0 alternative, jwt, next.js]
---

# Frequently asked questions

## The basics

### Is SelfAuth a library I install?

No. It is a **generator**. The CLI writes plain source code into your project, and nothing in that code depends on SelfAuth. You can uninstall the CLI and the app keeps working.

### Does anything phone home?

No. Generated code makes no calls to SelfAuth or any other service, apart from the database and mail provider **you** configure.

### How is it different from Auth0, Clerk or Firebase Auth?

Those are hosted services: your users live in their database. With SelfAuth your users live in **your** database, the code is yours to change, and there is no per-user fee. In return you run and operate it yourself, and you get fewer features (no social login or MFA yet).

### How is it different from Passport, Lucia or other libraries?

A library is a dependency you update and are bound to. SelfAuth gives you a tested implementation as your own code, with security settings as validated configuration and a conformance suite behind it.

### Is it free?

Yes. SelfAuth is MIT licensed, and generated output and templates are additionally offered under 0BSD, so generated code is yours without attribution obligations.

## Security and readiness

### Is it secure? Is it production-ready?

It is built with secure defaults and verified by a 90-case conformance suite, but it is **pre-alpha** and has had **no independent human security audit**. Treat it as suitable for evaluation and for projects where you review the code yourself. Read [Security model](/advanced/security) and [Going to production](/advanced/production).

### Why are passwords hashed with Argon2id?

It is the current recommended algorithm for password storage: deliberately slow and memory-hungry, so guessing is expensive.

### Can I use JWTs instead of session cookies?

Not in the generated code. SelfAuth uses opaque server-side sessions, so a session can be revoked immediately. See [Concepts](/guide/concepts).

### Why does the server refuse to start in production?

Strict checks on purpose: it needs a real database, a real mail provider, `https`, and secure cookies. See [Startup errors](/advanced/production#startup-errors-you-may-meet).

## Features

### Does it support social login (Google, GitHub), magic links, MFA or SSO?

Not today. Only email and password is implemented. Check the [roadmap](https://github.com/thetejasmagade/selfauth/blob/main/ROADMAP.md) for what is planned.

### Can users have several roles?

Yes. A user can hold many roles and holds the union of their permissions.

### Can I add my own fields to the user (name, avatar)?

Yes, but keep them in **your own table** that references `auth_users(id)`: see [Change the database](/build/database-changes). You may also add columns to `auth_users`, but the SelfAuth store will not read or write them.

### How do I let users log in with a username?

It is not built in: accounts are identified by email.

### Can I change the look of the sign-in pages?

Yes. The generated pages are unstyled HTML in `client/src/pages/auth/`. Edit them freely and add CSS.

### Can I run it on serverless platforms?

The generated servers are ordinary long-running HTTP servers. With the in-memory rate limiter or SQLite, state is per process, so use PostgreSQL (shared rate limits) if you run several instances. Cold starts are slowed by Argon2 hashing at sign-in. This is not specifically tested.

## Stacks

### Which frameworks are supported?

Express 5, Fastify 5 (TypeScript) and Gin (Go). Frontends: Vue 3 and React. See [Choose your stack](/getting-started/choose-your-stack).

### Can I use Next.js, NestJS, Django, Laravel...?

Not with a generated adapter. A frontend of any kind can call the [HTTP API](/api/http) of a SelfAuth backend. Other backends are not supported.

### Which databases?

PostgreSQL, MySQL (8 or MariaDB), SQLite, MongoDB (6+) and in-memory. PostgreSQL is the most thoroughly tested. Gin supports PostgreSQL and in-memory.

### Can I use it with an ORM other than Prisma?

The shipped SQL stores use Prisma and the Gin store uses pgx. You can write another store: see [Custom database store](/advanced/custom-store).

### Can I use SelfAuth in a monorepo?

Yes: run the commands inside each package. See [Existing projects](/advanced/existing-projects#monorepos).

## Using it

### Can I edit the generated code?

Yes, all of it. But the security core (`auth/core`, stores and adapters) is tested as a unit: prefer changing configuration. If you edit those files, `selfauth upgrade` will propose changes instead of applying them. See the [ownership map](/structure/#ownership-map).

### How do I update SelfAuth later?

`npx selfauth diff` then `npx selfauth upgrade`. Files you edited are never overwritten. See [`diff` and `upgrade`](/cli/upgrade).

### Do I need the CLI after generating?

No. It is useful for `doctor`, `validate`, database review and upgrades, but the app never needs it.

### Where do I put my own routes?

`src/routes/` (Go: `internal/routes/`). See [Add an API route](/build/add-api-route).

### How do I make the first admin?

With a server-side command after the person registered and verified: `npm run db:create-admin you@example.com`. See [Permissions and roles](/build/permissions-roles#the-first-administrator).

### Why is `/auth` not `/api/auth`?

The default `http.basePath` is `/auth`. You can change it in the configuration (the frontend client must use the same value).

### Can I use my own email templates?

Yes: branch on `message.kind` in your mailer. Keep the link exactly as given. See [Send real email](/build/email).

### How do I delete a user's data?

Account deletion removes the email and password and keeps a tombstone and audit events. See [Data retention](/advanced/data-retention).

## Project

### How do I report a bug or a vulnerability?

Bugs: [GitHub issues](https://github.com/thetejasmagade/selfauth/issues). Vulnerabilities: private reporting, as described in the [security policy](https://github.com/thetejasmagade/selfauth/blob/main/SECURITY.md).

### How can I contribute?

See [Contributing](/resources/contributing).
