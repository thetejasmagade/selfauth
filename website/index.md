---
layout: home
title: SelfAuth documentation
description: SelfAuth writes sign-up, sign-in, sessions, roles and permissions into your own project as code you own. Step-by-step guides for Express, Fastify, Next.js, Gin and Flask, from the first command to production.
keywords: [authentication, authorization, express, fastify, next.js, gin, flask, vue, react, postgresql, generator]

hero:
  name: SelfAuth
  text: Authentication. Fully yours.
  image:
    src: /logo.svg
    alt: SelfAuth logo
  tagline: One command puts sign-in, sessions, roles and permissions into your own project. You can read every line, change what you like, and deploy it anywhere. Nothing phones home.
  actions:
    - theme: brand
      text: What is SelfAuth?
      link: /start/what-is-selfauth
    - theme: alt
      text: Start the Express guide
      link: /express/
    - theme: alt
      text: Use an AI agent
      link: /ai/

features:
  - title: The code is yours
    details: SelfAuth is a code generator, not a service. The files land in your repository and keep working even if SelfAuth goes away.
    link: /start/what-is-selfauth
    linkText: Read the idea
  - title: One guide, start to finish
    details: Build a small notes app with sign-in, permissions, an admin view, your own table and migrations, a frontend page and tests. Every command was run for real.
    link: /express/
    linkText: Express guide
  - title: Your stack
    details: Express, Fastify, Next.js, Gin (Go) or Flask (Python). PostgreSQL, MySQL, SQLite or MongoDB. A Vue, React or Next.js frontend if you want one.
    link: /start/pick-your-stack
    linkText: Pick your stack
  - title: Let your AI agent do it
    details: Install the selfauth skill and ask Claude Code, Codex or Cursor to set it up. It uses the tested CLI instead of inventing auth code.
    link: /ai/
    linkText: Use the AI skill
---

## Where to start

| If you want to... | Go to |
| --- | --- |
| Understand the idea in five minutes | [What is SelfAuth?](/start/what-is-selfauth) |
| Choose a backend, database and frontend | [Pick your stack](/start/pick-your-stack) |
| Have your AI coding agent set it up | [Use with an AI agent](/ai/) |
| Build an app step by step | The [Express](/express/), [Fastify](/fastify/) or [Gin](/gin/) guide |
| Add your own table and migrate the database | [Add a table](/express/add-a-table) |
| Send real email through Resend, Postmark, SendGrid, Mailgun, Brevo or Amazon SES | [Email providers](/email/) |
| Add SelfAuth to a project you already have | [`selfauth add`](/reference/cli/add) |
| Fix an error message | [Troubleshooting](/help/troubleshooting) |

::: tip Pre-alpha software
SelfAuth is `0.x`, so minor versions can change the generated code. Every change is in the [changelog](/resources/changelog). Get the code reviewed by someone independent before real users depend on it, and read [Get ready for production](/express/production).
:::
