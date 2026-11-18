---
layout: home
title: SelfAuth documentation
description: SelfAuth generates login, sessions, roles and permissions as code inside your own project. Install it, run it, add routes and pages, and deploy it, with step-by-step guides.
keywords: [authentication, authorization, express, fastify, gin, vue, react, postgresql, generator]

hero:
  name: SelfAuth
  text: Authentication. Fully yours.
  tagline: One command writes login, sessions, roles and permissions into your own project. You read it, change it and deploy it. Nothing calls home.
  actions:
    - theme: brand
      text: Quick start
      link: /getting-started/quick-start
    - theme: alt
      text: What is SelfAuth?
      link: /guide/what-is-selfauth
    - theme: alt
      text: Project structure
      link: /structure/

features:
  - title: The code is yours
    details: SelfAuth is a code generator, not a service or a library. The files land in your repository and keep working without SelfAuth.
    link: /guide/what-is-selfauth
    linkText: Read the idea
  - title: Secure by default
    details: Argon2id password hashing, opaque server-side sessions, CSRF protection, rate limits and identical errors for unknown and known emails. 90 conformance cases prove it.
    link: /advanced/security
    linkText: Security model
  - title: Your stack
    details: Express, Fastify or Gin (Go). PostgreSQL, MySQL, SQLite, MongoDB or in-memory. Optional Vue or React frontend.
    link: /getting-started/choose-your-stack
    linkText: Choose a stack
  - title: Know where everything is
    details: Every generated folder is explained, with a map of where to add your own routes, pages, permissions and tables.
    link: /structure/
    linkText: Project structure
  - title: Build on top of it
    details: Step-by-step guides with tested code for adding API routes, permission checks, per-user data and frontend pages.
    link: /build/add-api-route
    linkText: Add a route
  - title: Reference you can trust
    details: Every CLI command, HTTP route, error code and configuration option, checked against the source by an automated test.
    link: /cli/
    linkText: CLI reference
---

## Where to start

| If you want to... | Go to |
| --- | --- |
| Understand the idea in five minutes | [What is SelfAuth?](/guide/what-is-selfauth) |
| Have a working app in ten minutes | [Quick start](/getting-started/quick-start) |
| See which files you got and what each one does | [Project structure](/structure/) |
| Add your own page, route or table | [Build your app](/build/add-api-route) |
| Add SelfAuth to a project you already have | [Existing projects](/advanced/existing-projects) |
| Fix an error message | [Troubleshooting](/troubleshooting) |

::: tip Pre-alpha software
SelfAuth is `0.x`. Minor versions can change generated code, and every change is listed in the [changelog](/resources/changelog). Have the code independently reviewed before you put real users on it. See [Going to production](/advanced/production).
:::
