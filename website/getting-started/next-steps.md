---
title: Next steps
description: A learning path after your first SelfAuth project runs. Where to read next to understand the files, add routes and pages, configure it and go to production.
keywords: [learning path, next steps, roadmap for beginners, tutorial order]
---

# Next steps

You now have a running project. This is a good order to learn the rest.

## A learning path

| Step | Read | You will be able to |
| --- | --- | --- |
| 1 | [Project structure](/structure/) | Find any file and know whether to edit it |
| 2 | [Add an API route](/build/add-api-route) | Create your own endpoint |
| 3 | [Protect routes](/build/protect-routes) | Require a signed-in user or a permission |
| 4 | [Permissions and roles](/build/permissions-roles) | Decide who may do what |
| 5 | [Resources and ownership](/build/resource-ownership) | Let users see only their own data |
| 6 | [Add a frontend page](/build/frontend-pages) | Add pages and guarded routes (Vue or React) |
| 7 | [Change the database](/build/database-changes) | Add your own tables and columns |
| 8 | [The configuration file](/configuration/config-file) | Tune sessions, passwords and limits |
| 9 | [Send real email](/build/email) | Replace the console mailer |
| 10 | [Going to production](/advanced/production) | Deploy safely |

## Quick answers

- **Which files should I never edit?** The folder `auth/` (TypeScript: `src/auth/core/`, Go: `internal/auth/`). See [the ownership map](/structure/#ownership-map).
- **Where do my own routes go?** `src/routes/` (TypeScript) or `internal/routes/` (Go).
- **Where do my own pages go?** `client/src/pages/`.
- **How do I change password rules?** `selfauth.config.ts`, then see [Configuration](/configuration/config-file#password).
- **How do I update SelfAuth later?** [`selfauth diff` and `upgrade`](/cli/upgrade).

## Get help

- [Troubleshooting](/troubleshooting) and the [FAQ](/faq)
- [GitHub issues](https://github.com/thetejasmagade/selfauth/issues) for bugs
- Report security problems privately, as described in the [security policy](https://github.com/thetejasmagade/selfauth/blob/main/SECURITY.md)
