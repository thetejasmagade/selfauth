---
title: Prerequisites
description: What you need installed before using SelfAuth. Node.js 22.18 or newer, npm, optionally Go 1.26 for Gin and a database. Includes how to check each one.
keywords: [prerequisites, requirements, node version, go version, install node, supported versions]
---

# Prerequisites

## What you need

| Tool | Version | Needed for | Check with |
| --- | --- | --- | --- |
| **Node.js** | 22.18 or newer | The CLI, and every Express and Fastify project (they run TypeScript directly) | `node --version` |
| **npm** | Comes with Node.js | Installing dependencies | `npm --version` |
| **Go** | 1.26 or newer | Only for the Gin backend | `go version` |
| **A database** | See below | Only when you leave the in-memory store | Depends on the database |
| **Git** | Any recent version | Strongly recommended, so you can review what SelfAuth wrote | `git --version` |

You do not need a database to try SelfAuth. The in-memory store keeps everything in the running process and forgets it on restart.

## Check your Node.js version

```bash
node --version
```

Expected output (any version at or above 22.18 is fine; yours will differ):

```text
v22.20.0
```

If the number is lower than 22.18, or the command is not found, install a current LTS release from [nodejs.org](https://nodejs.org) or with a version manager such as `nvm`, `fnm` or `volta`. Then open a **new** terminal and run the check again.

::: warning Why 22.18?
Generated TypeScript projects run with `node src/server.ts`, without a build step in development. Node.js added that capability by default in 22.18. Older versions fail with an "Unknown file extension .ts" error. See [Troubleshooting](/troubleshooting#unknown-file-extension-ts).
:::

## Databases

| Database | Version | Backends | Server to run? |
| --- | --- | --- | --- |
| In-memory | – | Express, Fastify, Gin | No. For trying things out only. |
| PostgreSQL | Current supported release | Express, Fastify, Gin | Yes |
| MySQL | 8, or MariaDB | Express, Fastify | Yes |
| SQLite | – | Express, Fastify | No. One file on disk. |
| MongoDB | 6 or newer | Express, Fastify | Yes |

For real use, PostgreSQL is the most thoroughly tested. See [What each database changes](/structure/databases).

## Supported operating systems

The CLI and generated projects run on macOS, Linux and Windows. On Windows, the commands in this documentation work in PowerShell and Command Prompt, except where a page says otherwise (for example the `curl` examples use Bash syntax: use Git Bash or WSL for those).

## Next

- [Choose your stack](./choose-your-stack)
