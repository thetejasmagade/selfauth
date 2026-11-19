---
title: Next steps
description: Where to go after your first SelfAuth project runs. A suggested reading order for the files, routes, pages, configuration and production.
keywords: [learning path, next steps, tutorial order]
---

# Next steps

You've got a running project. Here's the order I'd read things in.

Start with [Project structure](/structure/) so you know where everything is and which files are safe to edit. Then [add an API route](/build/add-api-route) of your own and [protect it](/build/protect-routes). Once that works, [permissions and roles](/build/permissions-roles) explain who can do what, and [resources and ownership](/build/resource-ownership) show how to let users see only their own data.

If you generated a frontend, [adding a page](/build/frontend-pages) is next. After that, [change the database](/build/database-changes) to add your own tables, tune things in [the configuration file](/configuration/config-file), and [send real email](/build/email). When you're ready to deploy, work through [Going to production](/advanced/production).

## Quick answers

- Files you shouldn't edit: the `auth/` folder (`src/auth/core/` in TypeScript, `internal/auth/` in Go). See the [ownership map](/structure/#ownership-map).
- Where your routes go: `src/routes/`, or `internal/routes/` in Go.
- Where your pages go: `client/src/pages/`.
- Changing password rules: edit the config, then check the [password section](/configuration/config-file#password).
- Updating SelfAuth later: [`selfauth diff` and `upgrade`](/cli/upgrade).

## Getting help

Try [Troubleshooting](/troubleshooting) and the [FAQ](/faq) first. Bugs go in [GitHub issues](https://github.com/thetejasmagade/selfauth/issues). Security problems should be reported privately, as described in the [security policy](https://github.com/thetejasmagade/selfauth/blob/main/SECURITY.md).
