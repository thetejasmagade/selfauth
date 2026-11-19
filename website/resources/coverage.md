---
title: Documentation coverage
description: A checklist that maps every SelfAuth feature, command, route and option to the documentation page that covers it, and how the automated check keeps the documentation in step with the code.
keywords: [documentation coverage, checklist, docs maintenance, add a page, docs check]
---

# Documentation coverage

This page maps every implemented feature to the page that documents it. Planned features are listed separately, and they aren't documented as if they existed.

## Feature coverage

| Area | Feature | Page |
| --- | --- | --- |
| Introduction | What it is, why, what it is not | [What is SelfAuth?](/guide/what-is-selfauth) |
| | Architecture, request and sign-in flows | [How it works](/guide/how-it-works) |
| | Glossary | [Concepts and terms](/guide/concepts) |
| Getting started | Requirements and versions | [Prerequisites](/getting-started/prerequisites) |
| | Backend, database and frontend choice | [Choose your stack](/getting-started/choose-your-stack) |
| | Install, run, expected output | [Quick start](/getting-started/quick-start) |
| | Register, verify, sign in, CSRF, rate limit | [Try the authentication flow](/getting-started/first-flow) |
| Project structure | Ownership map, where to add things | [Overview](/structure/) |
| | Express, Fastify, Gin, full stack | [Express](/structure/express), [Fastify](/structure/fastify), [Gin](/structure/gin), [Full stack](/structure/full-stack) |
| | PostgreSQL, MySQL, SQLite, MongoDB, memory | [What each database changes](/structure/databases) |
| Build | API routes (Express, Fastify, Gin) | [Add an API route](/build/add-api-route) |
| | Guards, deny-by-default | [Protect routes](/build/protect-routes) |
| | Permissions, roles, seed, first admin | [Permissions and roles](/build/permissions-roles) |
| | Ownership policies and list filters | [Resources and ownership](/build/resource-ownership) |
| | Vue and React pages, route guards, `Can` | [Add a frontend page](/build/frontend-pages) |
| | Own tables, migrations | [Change the database](/build/database-changes) |
| | Mailer | [Send real email](/build/email) |
| | Tests | [Write tests](/build/tests) |
| Configuration | Every configuration option | [The configuration file](/configuration/config-file) |
| | Every environment variable | [Environment variables](/configuration/environment) |
| | Cookies, CORS, CSRF topologies | [Frontend deployment](/configuration/frontend-deployment) |
| CLI | `init` | [init](/cli/init) |
| | `add`, `add-frontend` | [add](/cli/add) |
| | `detect`, `list`, `doctor`, `validate` | [inspect](/cli/inspect) |
| | `diff`, `upgrade` | [upgrade](/cli/upgrade) |
| | `db` | [db](/cli/db) |
| | `skill install` | [skill](/cli/skill) |
| API | Every `/auth` route | [HTTP API](/api/http) |
| | Every error code | [Error codes](/api/errors) |
| | TypeScript server API | [Server API](/api/server) |
| | Go server API | [Go and Gin](/api/go) |
| | Frontend client | [Client API](/api/client) |
| AI skill | Install, workflow, rules, prompts | [Use the AI skill](/ai-skill/), [Prompts that work](/ai-skill/prompts) |
| Advanced | Security model | [Security model](/advanced/security) |
| | Deployment | [Going to production](/advanced/production) |
| | Existing projects, monorepos | [Existing projects](/advanced/existing-projects) |
| | New database store | [Custom database store](/advanced/custom-store) |
| | Deletion and retention | [Data retention](/advanced/data-retention) |
| | Conformance levels | [Conformance and support](/advanced/conformance) |
| | Leaving another system | [Moving from another auth system](/advanced/migrating) |
| Help | Symptoms and fixes | [Troubleshooting](/troubleshooting) |
| | Questions | [FAQ](/faq) |
| Resources | Release notes, contributing, license | [Changelog](/resources/changelog), [Contributing](/resources/contributing), [License](/resources/license) |

## Planned or not available

These aren't implemented, so the docs don't describe them as usable:

- Social login, magic links, passkeys, multi-factor authentication and single sign-on.
- Merging into an existing Prisma schema with `selfauth add`.
- Generated frontends for frameworks other than Vue and React; a generated frontend for Gin.
- Backends other than Express, Fastify and Gin.
- An independent security audit (required before 1.0).

## How the documentation is kept in step with the code

`pnpm docs:check` runs in CI and fails when the documentation drifts from the code:

| Check | What it compares |
| --- | --- |
| Frontmatter | Every page has a title and a description |
| No placeholders | No page contains an unfinished-work marker or filler text |
| CLI | Every command and every option in `packages/cli/src/bin.ts` appears on its CLI page |
| Configuration | Every key in the configuration specification table appears in the configuration page |
| HTTP API | Every route in the HTTP API table of the repository docs appears in the HTTP page |
| Errors | Every error code in the error specification appears in the error page |
| Environment | Every variable read by the generated `env` code appears in the environment page |
| Sidebar | Every page is in the sidebar, and every sidebar link has a page |

## Adding a page

1. Create `website/<section>/<name>.md` with this frontmatter:

   ```yaml
   ---
   title: Short page title
   description: One or two sentences for search results and link previews.
   keywords: [a, few, words]
   ---
   ```

2. Add it to the `sidebar` in `website/.vitepress/config.mts`, and to the table above.
3. Write for a beginner: explain terms, show the command, show the expected output, say where the code goes.
4. Run `pnpm docs:check` and `pnpm docs:build`. The build fails on a dead internal link.
5. Mark output as real only if you copied it from a run of the current version.

When you add a CLI option, a route or an error code, the check tells you which page is missing it.
