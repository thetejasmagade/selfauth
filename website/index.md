---
layout: home
title: SelfAuth documentation
description: SelfAuth generates login, sessions, roles and permissions as code inside your own project. Install it, run it, add routes and pages, and deploy it, with step-by-step guides.
keywords: [authentication, authorization, express, fastify, gin, vue, react, postgresql, generator]

hero:
  name: SelfAuth
  text: Authentication. Fully yours.
  image:
    src: /logo.svg
    alt: SelfAuth logo
  tagline: One command puts login, sessions, roles and permissions into your own project. You can read every line, change what you like, and deploy it anywhere. Nothing phones home.
  actions:
    - theme: brand
      text: Use the AI skill
      link: /ai-skill/
    - theme: alt
      text: Quick start
      link: /getting-started/quick-start
    - theme: alt
      text: What is SelfAuth?
      link: /guide/what-is-selfauth
    - theme: alt
      text: Project structure
      link: /structure/

features:
  - title: Let your AI agent do it
    details: Install the selfauth skill and ask Claude Code, Codex or Cursor to add login to your project. It uses the tested CLI instead of inventing auth code, and it checks its own work.
    link: /ai-skill/
    linkText: Use the AI skill
  - title: The code is yours
    details: SelfAuth is a code generator, not a service or a library. The files land in your repository, and they keep working even if SelfAuth goes away.
    link: /guide/what-is-selfauth
    linkText: Read the idea
  - title: Safe defaults
    details: Argon2id hashing, server-side sessions, CSRF protection, rate limits, and the same error whether or not an email exists. A suite of 90 conformance cases backs it up.
    link: /advanced/security
    linkText: Security model
  - title: Your stack
    details: Express, Fastify or Gin (Go). PostgreSQL, MySQL, SQLite, MongoDB, or just memory. A Vue or React frontend if you want one.
    link: /getting-started/choose-your-stack
    linkText: Choose a stack
  - title: Know where things are
    details: Every generated folder is explained, along with where your own routes, pages, permissions and tables go.
    link: /structure/
    linkText: Project structure
  - title: Build on it
    details: Walkthroughs with tested code for adding routes, permission checks, per-user data and frontend pages.
    link: /build/add-api-route
    linkText: Add a route
  - title: Reference that stays accurate
    details: Every CLI command, HTTP route, error code and config option, checked against the source by a test.
    link: /cli/
    linkText: CLI reference
---

## Where to start

| If you want to... | Go to |
| --- | --- |
| Have your AI coding agent set it up | [Use the AI skill](/ai-skill/) |
| Understand the idea in five minutes | [What is SelfAuth?](/guide/what-is-selfauth) |
| Have a working app in ten minutes | [Quick start](/getting-started/quick-start) |
| See which files you got and what each one does | [Project structure](/structure/) |
| Add your own page, route or table | [Build your app](/build/add-api-route) |
| Add SelfAuth to a project you already have | [Existing projects](/advanced/existing-projects) |
| Fix an error message | [Troubleshooting](/troubleshooting) |

::: tip Pre-alpha software
SelfAuth is `0.x`, so minor versions can change the generated code. Every change is in the [changelog](/resources/changelog). Get the code reviewed by someone independent before real users depend on it, and read [Going to production](/advanced/production).
:::
