---
title: CLI overview
description: The selfauth command-line tool. What it does, how to run it, every command in one table, exit codes and the JSON output used by scripts and coding agents.
keywords: [selfauth cli, npx selfauth, commands, selfauth --help, json output, exit codes]
---

# CLI overview

The `selfauth` CLI is a development tool. It writes files into your project, checks them, and helps you update them later. Nothing it generates calls it at runtime, so you could delete it from your machine and the app would carry on working.

## Running it

There's nothing to install:

```bash
npx selfauth <command>
```

Or add it to a project as a dev dependency, so the whole team uses the same version:

```bash
npm install -D @selfauth/cli
npx selfauth --version
```

```text
0.15.0
```

`selfauth` and `@selfauth/cli` are the same tool. It needs Node.js 22.18 or newer.

## All commands

| Command | What it does | Writes files? |
| --- | --- | :---: |
| [`init [dir]`](./init) | Create a new project (Express, Fastify, Gin or Flask) | yes |
| [`add [dir]`](./add) | Add SelfAuth to an existing Express or Fastify project | yes (new files only) |
| [`add-frontend [dir]`](./add#selfauth-add-frontend) | Add the auth module to an existing Vue or React app | yes (new files only) |
| [`detect [dir]`](./inspect#selfauth-detect) | Inspect a project and recommend the right command | no |
| [`list`](./inspect#selfauth-list) | List the supported integrations | no |
| [`doctor [dir]`](./inspect#selfauth-doctor) | Configuration and production-readiness checks | no |
| [`validate [dir]`](./inspect#selfauth-validate) | Check the configuration, generated files and the schema | no |
| [`diff [dir]`](./upgrade#selfauth-diff) | Show what a newer version would change | no |
| [`upgrade [dir]`](./upgrade#selfauth-upgrade) | Update generated files you have not edited | yes |
| [`db status\|plan\|migrate\|validate\|rollback\|generate`](./db) | Review and apply database migrations | database |
| [`skill install [dir]`](./skill) | Install the agent skill for Claude Code, Codex or Cursor | yes |

Ask any command for help:

```bash
npx selfauth --help
npx selfauth init --help
```

## Conventions

- `[dir]` is the project folder. Leave it out to use the current one.
- `--dry-run` shows what would be written and writes nothing. Use it first wherever it exists.
- `-y` or `--yes` answers "yes" to every question, so commands can run in scripts and CI.
- `--json` (on `detect`, `list`, `doctor` and `validate`) prints machine-readable output for scripts and coding agents.
- Exit code `0` means success. Anything else means a problem was found or the command failed. `doctor` and `validate` exit non-zero when they report errors, so they can fail a CI job.
- `init`, `add` and `add-frontend` only create files. They never overwrite one that exists.

## In a full-stack project

At the root of a project with `server/` and `client/`, `doctor`, `validate`, `diff` and `upgrade` cover both packages. The `db` commands find `server/` on their own.

## Using the CLI in CI

```yaml
- run: npx selfauth validate
- run: npx selfauth doctor
```

The first fails the build if the configuration is invalid or the schema and manifest disagree. The second reports production readiness warnings.
