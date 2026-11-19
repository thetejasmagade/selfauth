---
title: Prompts that work
description: Example requests to give your coding agent once the selfauth skill is installed - add authentication to a new or existing project, protect routes, change roles, upgrade - and how to check its work.
keywords: [prompts, ai prompts, claude code prompts, add login, protect routes, upgrade selfauth, agent examples]
---

# Prompts that work

With the [skill installed](./), you can talk to your agent normally. A few specifics help it make good choices, mainly your stack, your database and the permissions you'll need. These are starting points to adapt. Each one has a copy button.

## Start a new project

```prompt
Create a new Express API in my-app with SelfAuth. Use PostgreSQL and a React frontend. The permissions I need are orders.view and orders.create.
```

The agent will pick `selfauth init`, show you the plan, and ask before writing. If you leave something out (the database, say) it asks, or uses the defaults and tells you.

For Go:

```prompt
Make a new Gin API called shop-api with SelfAuth on PostgreSQL. The Go module is github.com/acme/shop-api.
```

## Add authentication to an existing project

```prompt
Add SelfAuth to this project. Use the in-memory store for now, I'll move to PostgreSQL later.
```

```prompt
This repo already has some login code. Show me what you find before you change anything.
```

The second one is a good habit for any project with existing auth. The agent lists each file and line, then waits for your decision.

## Protect your own routes

```prompt
Protect the /api/orders routes. Users should only see their own orders, and support staff with orders.view_any can see everyone's.
```

This maps onto [Resources and ownership](/build/resource-ownership). The agent should use the ownership policy and list filter, and it should take the owner from the session rather than the request body. Check that it did.

```prompt
Require the reports.manage permission for the reports endpoints, and give it to the admin role.
```

## Work with roles and permissions

```prompt
Add a support role that can view all orders but not create any. Update the seed too.
```

Roles live in the configuration, and the seed writes them to the database. A good agent edits the config and tells you to run the seed, or runs it if you've said it can. See [Permissions and roles](/build/permissions-roles).

## Frontend

```prompt
Add an Orders page at /orders that only users with orders.view can open, and show the create form only to users with orders.create.
```

That's the walkthrough in [Add a frontend page](/build/frontend-pages).

## Check and upgrade

```prompt
Check whether this project's SelfAuth setup is healthy and ready for production.
```

The agent runs `doctor` and `validate` and explains the warnings.

```prompt
Upgrade SelfAuth to the latest version. Show me what would change first, and don't touch the files I edited.
```

It should run `selfauth diff`, then `upgrade`, then walk you through any `.selfauth-new` proposals. See [`diff` and `upgrade`](/cli/upgrade).

## Ask questions

```prompt
Does SelfAuth support JWTs?
```

```prompt
What happens to a user's sessions when they change their password?
```

Questions don't change your code. The agent answers from the docs and the specification.

## Checking the agent's work

A good report from the agent has these parts, and a vague one is a reason to push back:

| Part | What you want to see |
| --- | --- |
| Status | "complete", or "incomplete" with the reason |
| Command run | The exact `selfauth` command |
| Files it changed | Which of your files, and what it changed in each |
| Verified | The validation result, with the checks listed |
| Not verified | Every skipped check, and why |
| Manual steps left | Email provider, production database, anything else |

Then do three things yourself before committing:

1. Read the diff for your own files. The generated files are tested, so your own routes are where mistakes happen.
2. Start the app and try the [authentication flow](/getting-started/first-flow) once.
3. Run `npx selfauth doctor`.

## When the agent won't do something

Sometimes it stops and says no. That's the skill working. Common cases:

- "That framework isn't supported." SelfAuth supports Express, Fastify and Gin. Check [Choose your stack](/getting-started/choose-your-stack).
- "The CLI can't generate that." It won't hand-write password hashing, tokens or CSRF code. If you need something SelfAuth doesn't do, like social login, that's not available yet.
- "I need your approval first." Destructive migrations and replacing existing auth always wait for you.

If you'd rather not use an agent, everything it does is documented here, step by step. Start with the [quick start](/getting-started/quick-start).
