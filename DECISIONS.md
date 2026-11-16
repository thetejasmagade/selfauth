# Architecture decisions

Index of Architecture Decision Records (ADRs). Full text lives in
[`docs/adr/`](docs/adr/). Process: [ADR 0001](docs/adr/0001-record-architecture-decisions.md).

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](docs/adr/0001-record-architecture-decisions.md) | Record decisions as ADRs; supersede, never rewrite | Accepted |
| [0002](docs/adr/0002-project-local-authentication-only.md) | Project-local authentication is the only model; no runtime SelfAuth service | Accepted |
| [0003](docs/adr/0003-installation-modes.md) | Three installation modes: CLI, packages, manual templates | Accepted |
| [0004](docs/adr/0004-generated-code-ownership-and-upgrades.md) | Generated code is app-owned; manifest + three-way upgrades; no silent writes | Accepted |
| [0005](docs/adr/0005-initial-tooling-stack.md) | TypeScript 6, Node ≥ 22, pnpm, Turborepo, Commander, Zod, Vitest, Playwright, VitePress, GitHub Actions, Changesets | Accepted |
| [0006](docs/adr/0006-mvp-stack.md) | MVP: Express + PostgreSQL/Prisma + Vue 3; then React, MongoDB/Mongoose | Accepted |
| [0007](docs/adr/0007-specification-driven-development.md) | Requirement IDs; every MUST covered by a conformance case or verification method, enforced in CI | Accepted |
| [0008](docs/adr/0008-opaque-server-side-sessions.md) | Opaque, hashed, server-side sessions in HttpOnly cookies by default | Accepted |
| [0009](docs/adr/0009-password-hashing.md) | Argon2id via maintained native libraries; PHC strings; rehash on login | Accepted |
| [0010](docs/adr/0010-license.md) | Apache-2.0 for SelfAuth; generated output also 0BSD | Superseded by 0013 |
| [0011](docs/adr/0011-versioning-and-release.md) | Semver via Changesets; independent `specVersion`; `0.x` until stable | Accepted |
| [0012](docs/adr/0012-contribution-model.md) | DCO sign-off; maintainer review for security-sensitive areas | Accepted |
| [0013](docs/adr/0013-mit-license.md) | MIT for SelfAuth; generated output also 0BSD | Accepted |
