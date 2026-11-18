---
title: Prerequisites
description: What you need installed before using SelfAuth. Node.js 22.18 or newer, npm, optionally Go 1.26 for Gin and a database. Includes how to check each one.
keywords: [prerequisites, requirements, node version, go version, install node, supported versions]
---

# Prerequisites

## What you need

| Tool | Version | Needed for | Check with |
| --- | --- | --- | --- |
| Node.js | 22.18 or newer | The CLI, and every Express and Fastify project (they run TypeScript directly) | `node --version` |
| npm | Comes with Node.js | Installing dependencies | `npm --version` |
| Go | 1.26 or newer | Only for the Gin backend | `go version` |
| A database | See below | Only when you leave the in-memory store | Depends on the database |
| Git | Any recent version | Strongly recommended, so you can review what SelfAuth wrote | `git --version` |

You don't need a database just to try things. The in-memory store keeps data in the running process and loses it on restart, which is fine for a first look.

## Check your Node.js version

```bash
node --version
```

Any version at or above 22.18 is fine. Yours will differ from this:

```text
v22.20.0
```

If it's lower than 22.18, or the command isn't found, install the current LTS from [nodejs.org](https://nodejs.org) or through a version manager like `nvm`, `fnm` or `volta`. Open a new terminal afterwards and check again.

Generated TypeScript projects run with `node src/server.ts` and no build step in development. Node only started allowing that by default in 22.18, so older versions fail with an "Unknown file extension .ts" error. There's more in [Troubleshooting](/troubleshooting#unknown-file-extension-ts).

## Databases

| Database | Version | Backends | Server to run? |
| --- | --- | --- | --- |
| In-memory | – | Express, Fastify, Gin | No. For trying things out only. |
| PostgreSQL | Current supported release | Express, Fastify, Gin | Yes |
| MySQL | 8, or MariaDB | Express, Fastify | Yes |
| SQLite | – | Express, Fastify | No. One file on disk. |
| MongoDB | 6 or newer | Express, Fastify | Yes |

For anything real, PostgreSQL is the best tested. [What each database changes](/structure/databases) covers the differences.

## Supported operating systems

Everything runs on macOS, Linux and Windows. The commands here work in PowerShell and Command Prompt too, except the `curl` examples, which use Bash syntax. On Windows, run those from Git Bash or WSL.
