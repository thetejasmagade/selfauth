---
title: Conformance and support
description: How SelfAuth proves its code is correct - the specification, the 90 language-neutral conformance cases, compliance levels, and which backends and databases reach which level.
keywords: [conformance, compliance levels, specification, support matrix, production profile, test suite, supported versions]
---

# Conformance and support

A generator that runs is not necessarily correct. SelfAuth keeps a **specification** that says what authentication must do, and a **conformance suite** that checks implementations against it.

## The pieces

| Piece | What it is |
| --- | --- |
| **Specification** | Numbered, testable rules (`SEC-CSRF-004`, `AUTHN-SESS-001`, and so on) in `packages/spec/specs/` |
| **Conformance suite** | 90 language-neutral JSON cases. A TypeScript runner drives any implementation over HTTP through a small driver |
| **Adapter record** | For each backend, a JSON file listing which requirements are proven by a case and which are signed off with evidence |

Every backend (Express, Fastify, Gin) is started in isolation for each case and must pass all 90, on every store it supports.

## Compliance levels

| Level | Needs |
| --- | --- |
| Core compliant | All core cases pass and every non-case core requirement is signed off |
| Authorization compliant | Core, plus the authorization cases |
| Production-profile compliant | All cases, plus every review, documentation and static-analysis item signed off |

## What is claimed today

| Backend / store | Level |
| --- | --- |
| Express + PostgreSQL | Production-profile compliant (self-assessed) |
| Express + memory, MySQL, SQLite, MongoDB | Authorization compliant |
| Fastify, Gin (PostgreSQL and memory) | 90 of 90 cases, authorization level, until their production profile is reviewed |

"Production-profile compliant" is **self-assessed**. No independent audit has been done: see [Security model](./security).

## Tested versions

| Component | Version |
| --- | --- |
| Node.js | 22.18 or newer |
| Go | 1.26 or newer |
| Express | 5.x |
| Fastify | 5.x |
| Gin | 1.12 |
| Prisma | 7.x |
| PostgreSQL | 16 in CI |
| TypeScript in your project | 5.7 or newer |

## Where to read more

- [Conformance and support matrix, Express](https://github.com/thetejasmagade/selfauth/blob/main/docs/conformance.md)
- [For Fastify](https://github.com/thetejasmagade/selfauth/blob/main/docs/conformance-fastify.md) and [for Gin](https://github.com/thetejasmagade/selfauth/blob/main/docs/conformance-gin.md)
- [Specification](https://github.com/thetejasmagade/selfauth/tree/main/packages/spec/specs)
- [Security review](https://github.com/thetejasmagade/selfauth/blob/main/docs/security-review.md)

## Next

- [Moving from another auth system](./migrating)
