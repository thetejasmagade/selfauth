---
title: Frequently asked questions
description: Answers about SelfAuth - what it is, whether it is secure and production-ready, which stacks it supports, how to add social login or MFA, licensing, upgrades, and how it differs from hosted auth providers.
keywords: [faq, questions, is selfauth production ready, social login, mfa, license, auth0 alternative, jwt, next.js]
---

# Frequently asked questions

## The basics

### Is SelfAuth a library I install?

No, it's a generator. The CLI writes plain source code into your project, and nothing in that code depends on SelfAuth. Uninstall the CLI and the app carries on.

### Does anything phone home?

No. Generated code doesn't call SelfAuth or anything else, apart from the database and mail provider you configure.

### How is it different from Auth0, Clerk or Firebase Auth?

Those are hosted services, so your users live in their database. With SelfAuth they live in yours, you can change the code, and there's no per-user fee. The trade-off is that you run it yourself, and it does less: no social login or MFA yet.

### How is it different from Passport, Lucia or other libraries?

A library is a dependency you have to keep updating and live with. SelfAuth hands you a tested implementation as your own code, with the security settings as validated configuration and a conformance suite behind it.

### Is it free?

Yes. SelfAuth is MIT licensed, and the generated output and templates are also offered under 0BSD, so the code in your project comes with no attribution requirement.

## Security and readiness

### Is it secure? Is it production-ready?

It has safe defaults and passes a 90-case conformance suite, but it's pre-alpha and nobody outside the project has audited it. That makes it good for evaluating, and for projects where you'll review the code yourself. Don't trust it blindly. Read the [Security model](/start/how-it-works) and [Going to production](/express/production).

### Why are passwords hashed with Argon2id?

It's the currently recommended algorithm for storing passwords. It's slow and memory-hungry by design, which makes guessing expensive.

### Can I use JWTs instead of session cookies?

Not in the generated code. SelfAuth uses opaque server-side sessions, so a session can be revoked immediately. See [Concepts](/start/how-it-works).

### Why does the server refuse to start in production?

Those checks are there to protect you. Production needs a real database, a real mail provider, `https` and secure cookies. See [Startup errors](/express/production).

## Features

### Does it support social login (Google, GitHub), magic links, MFA or SSO?

Not yet. Only email and password works today. The [roadmap](https://github.com/thetejasmagade/selfauth/blob/main/ROADMAP.md) shows what's planned.

### Can users have several roles?

Yes. A user can have several roles and gets the union of their permissions.

### Can I add my own fields to the user (name, avatar)?

Yes, but keep them in your own table that references `auth_users(id)`: see [Change the database](/express/add-a-table). You may also add columns to `auth_users`, but the SelfAuth store will not read or write them.

### How do I let users log in with a username?

Not built in. Accounts are identified by email.

### Can I change the look of the sign-in pages?

Yes. The generated pages are unstyled HTML in `client/src/pages/auth/`, so edit them and add CSS freely.

### Can I run it on serverless platforms?

The generated servers are ordinary long-running HTTP servers. With the in-memory rate limiter or SQLite, state lives in one process, so use PostgreSQL if you run several instances and want shared rate limits. Argon2 hashing also slows sign-in on a cold start. None of this has been tested on serverless platforms specifically.

## Stacks

### Which frameworks are supported?

Express 5, Fastify 5 (both TypeScript) and Gin (Go). Frontends are Vue 3 and React. See [Choose your stack](/start/pick-your-stack).

### Can I use Next.js, NestJS, Django, Laravel...?

Not with a generated adapter. A frontend of any kind can call the [HTTP API](/reference/http) of a SelfAuth backend, but other backends aren't supported.

### Which databases?

PostgreSQL, MySQL (8 or MariaDB), SQLite, MongoDB (6+) and in-memory. PostgreSQL is the best tested. Every database works with Express, Fastify and Gin.

### Can I use it with an ORM other than Prisma?

The shipped SQL stores use Prisma, and the Gin store uses pgx. You can write another store. See [Custom database store](/reference/server-typescript).

### Can I use SelfAuth in a monorepo?

Yes, run the commands inside each package. See [Existing projects](/reference/cli/add).

## Using it

### Can I edit the generated code?

Yes, all of it. The security core (`auth/core`, the stores and the adapters) is tested as a unit though, so prefer changing configuration. If you edit those files, `selfauth upgrade` will write proposals instead of applying changes. See the [ownership map](/express/project-tour).

### How do I update SelfAuth later?

Run `npx selfauth diff` and then `npx selfauth upgrade`. Files you've edited are never overwritten. See [`diff` and `upgrade`](/reference/cli/upgrade).

### Do I need the CLI after generating?

No. It's handy for `doctor`, `validate`, database review and upgrades, but the app never needs it.

### Where do I put my own routes?

In `src/routes/` (`internal/routes/` for Go). See [Add an API route](/express/endpoints).

### How do I make the first admin?

With a command you run on the server, after the person has registered and verified: `npm run db:create-admin you@example.com`. See [Permissions and roles](/express/permissions).

### Why is `/auth` not `/api/auth`?

That's the default `http.basePath`, and you can change it in the configuration. The frontend client has to use the same value.

### Can I use my own email templates?

Yes. Branch on `message.kind` in your mailer, and keep the link exactly as given. See [Send real email](/express/production).

### How do I delete a user's data?

Deleting an account removes the email and password, and keeps a tombstone and audit events. See [Data retention](/express/production).

## Project

### How do I report a bug or a vulnerability?

Bugs go in [GitHub issues](https://github.com/thetejasmagade/selfauth/issues). Vulnerabilities go through private reporting, as described in the [security policy](https://github.com/thetejasmagade/selfauth/blob/main/SECURITY.md).

### How can I contribute?

See [Contributing](/resources/contributing).
