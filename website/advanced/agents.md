---
title: Coding agents
description: Let Claude Code, Codex or Cursor add and verify SelfAuth for you with the selfauth skill. How to install it, what it makes the agent do, and the machine-readable commands it uses.
keywords: [claude code, codex, cursor, ai agent, skill, SKILL.md, agent integration, llm]
---

# Coding agents

SelfAuth works without any AI. But if you use a coding agent, the `selfauth` skill keeps it on the safe path: the agent runs the CLI to generate authentication instead of writing it from scratch (which is where security mistakes come from).

## Install

```bash
npx selfauth skill install --agent claude     # or codex, cursor, all
```

| Agent | Folder |
| --- | --- |
| Claude Code | `.claude/skills/selfauth/` |
| Codex | `.agents/skills/selfauth/` |
| Cursor | `.cursor/skills/selfauth/` |

Commit the folder so the whole team's agents use it, and re-run with `--update` after upgrading the CLI. Details per agent are in the repository's [`integrations/`](https://github.com/thetejasmagade/selfauth/tree/main/integrations) folder.

## What the skill makes the agent do

The skill gives the agent a workflow and a set of rules it must not break.

Workflow

1. Inspect the project with `selfauth detect --json` and read the whole report.
2. Choose the path from its `recommendation`: `init` (a new project), `add` (an existing Express or Fastify project), `add-frontend` (an existing Vue or React app), `workspace` (a monorepo: run detect in each package), `upgrade` (SelfAuth is already installed), or `unsupported` (stop and say why).
3. Handle existing authentication: list what was found and ask before doing anything.
4. Read the relevant part of the specification, then run the CLI (with `--dry-run` first), review database migrations with `selfauth db plan`, and wire the result in.
5. Validate before saying "done": a validation script must pass, and anything it skipped is reported as *not verified*.

Rules the agent follows

- Never hand-write security code (password hashing, session or token generation, cookies, CSRF, rate limiting, permission checks). If the CLI cannot generate it, the agent says so and stops.
- Never invent adapters. Only what `selfauth list` reports is supported.
- Never replace or remove existing authentication without your approval.
- Never run destructive migrations without your explicit approval of the exact findings.
- Never print or commit secrets (`.env`, `DATABASE_URL`, `SELFAUTH_CSRF_SECRET`, passwords, tokens).
- Report what is manual: the email provider, the production database and deployment.
- Leave the security core (`src/auth/**`) alone unless you ask.

## Machine-readable output

These commands take `--json`: `detect`, `list`, `doctor`, `validate`. Scripts use the same output.

```bash
npx selfauth detect --json
npx selfauth list --json
```

## An example request

> Add SelfAuth to this Express project with PostgreSQL and the permissions `orders.view` and `orders.create`.

A well-behaved agent runs `detect`, shows you the `add --dry-run` plan, adds the files, completes the manual steps (tsconfig options, the two wiring lines), runs the migration review and the validators, and reports what it could not verify.
