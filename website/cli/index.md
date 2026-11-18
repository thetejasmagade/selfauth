---
title: CLI overview
description: The selfauth command-line tool. What it does, how to run it, every command in one table, exit codes and the JSON output used by scripts and coding agents.
keywords: [selfauth cli, npx selfauth, commands, selfauth --help, json output, exit codes]
---

# CLI overview

The `selfauth` CLI is a development tool. It writes files into your project, checks them and helps you update them. Nothing it generates calls it at runtime, so you can delete it from your machine and your app keeps working.

## Running it

You do not have to install anything:

```bash
npx selfauth <command>
```

Or add it to a project as a development dependency, so everyone on the team uses the same version:

```bash
npm install -D @selfauth/cli
npx selfauth --version
```

```text
0.15.0
```

The packages `selfauth` and `@selfauth/cli` are the same tool. Node.js 22.18 or newer is required.

## All commands

| Command | What it does | Writes files? |
| --- | --- | :---: |
| [`init [dir]`](./init) | Create a new project (Express, Fastify or Gin) | yes |
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

Get help for any command:

```bash
npx selfauth --help
npx selfauth init --help
```

## Conventions

- `[dir]` is the project folder. Leave it out to use the current folder.
- `--dry-run` shows what would be written and writes nothing. Use it first whenever it exists.
- `-y`, `--yes` answers "yes" to every question, so the command can run in scripts and CI.
- `--json` (on `detect`, `list`, `doctor`, `validate`) prints machine-readable output, for scripts and coding agents.
- Exit codes: `0` means success. A non-zero code means a problem was found or the command failed. `doctor` and `validate` return non-zero when they report errors, so they can fail a CI job.
- New files only: `init`, `add` and `add-frontend` never overwrite a file that already exists.

## In a full-stack project

At the root of a project with `server/` and `client/`, `doctor`, `validate`, `diff` and `upgrade` cover both packages. `db` commands find `server/` themselves.

## Using the CLI in CI

```yaml
- run: npx selfauth validate
- run: npx selfauth doctor
```

The first fails the build if the configuration is invalid or the schema and manifest disagree. The second reports production-readiness warnings.
