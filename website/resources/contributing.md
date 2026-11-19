---
title: Contributing
description: How to contribute to SelfAuth - development setup, pull request rules, writing specification requirements and the rules for AI coding agents that work on the repository.
keywords: [contributing, pull request, development setup, pnpm, changeset, adr, developer certificate of origin]
---

# Contributing

SelfAuth generates security-sensitive code that other people run in production, so contributions get a careful review. The full guide is [`CONTRIBUTING.md`](https://github.com/thetejasmagade/selfauth/blob/main/CONTRIBUTING.md). This is the short version.

## Before you start

1. Read [`ARCHITECTURE.md`](https://github.com/thetejasmagade/selfauth/blob/main/ARCHITECTURE.md) and [`DECISIONS.md`](https://github.com/thetejasmagade/selfauth/blob/main/DECISIONS.md).
2. For behavior changes, read the relevant [specification](https://github.com/thetejasmagade/selfauth/tree/main/packages/spec/specs).
3. For anything larger than a bug fix, open an issue first. New adapters always start with an issue.

## Development setup

You need Node.js 22.18 or newer and pnpm 10, plus Go 1.26 if you're touching the Gin app.

```bash
git clone https://github.com/thetejasmagade/selfauth.git
cd selfauth
corepack enable
pnpm install
pnpm check          # format check, lint, typecheck, tests
pnpm build
```

PostgreSQL tests run when `TEST_DATABASE_URL` is set. CI always runs them.

## This documentation site

The site is the `website/` package, built with VitePress. Pages are Markdown files in `website/`.

```bash
pnpm docs:dev       # live-reloading preview at http://localhost:5173
pnpm docs:build     # production build into website/.vitepress/dist
pnpm docs:preview   # serve the production build at http://localhost:4173
pnpm docs:check     # checks the docs against the source code
```

### Deploying to Vercel

Import the repository in Vercel and set the Root Directory to `website`. `website/vercel.json` supplies the rest: the VitePress preset, `pnpm install --frozen-lockfile`, `pnpm docs:build` and the `.vitepress/dist` output. Leave "Include source files outside of the Root Directory" switched on, because the changelog page reads `packages/cli/CHANGELOG.md`. Canonical URLs and the sitemap use the production domain Vercel provides, or `DOCS_HOSTNAME` if you set it.

[Documentation coverage](./coverage) explains how pages are kept in step with the code, and how to add one.

## Pull requests

- Keep them small and focused, with acceptance criteria in the description.

## Rules for AI coding agents working on the repository

No mandatory runtime service, no custom cryptography, no overwriting application code without review, no destructive migrations without approval, tests for every security-sensitive feature, and no claiming something is finished without validating it. The full list is in `CONTRIBUTING.md`.
