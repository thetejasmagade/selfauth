---
title: Custom database store
description: Use a database that SelfAuth does not ship by implementing the AuthStore and RateLimitStore interfaces and proving it with the conformance suite.
keywords: [custom store, AuthStore, RateLimitStore, conformance, new database, extend, adapter]
---

# Custom database store

SelfAuth ships stores for PostgreSQL, MySQL, SQLite, MongoDB and memory. If you use something else (DynamoDB, CockroachDB, a legacy schema), you can write your own store without touching the security core, because the core talks to storage only through an interface.

::: warning Be careful
The store carries security guarantees: single-use tokens, atomic rate limits, unique emails. A wrong store breaks them silently. Prove yours with the conformance suite before relying on it.
:::

## The interfaces (TypeScript)

`src/auth/core/store.ts` defines `AuthStore`. In groups:

| Group | Methods |
| --- | --- |
| Users | `createUser`, `findUserById`, `findUserByEmail(emailNormalized)`, `updateUser` |
| Credentials | `getPasswordHash`, `setPasswordHash`, `deleteCredentials` |
| Sessions | `createSession`, `findSessionByTokenHash`, `findSessionById`, `touchSession`, `revokeSession`, `revokeUserSessions`, `listActiveSessions` |
| One-time tokens | `createToken`, `findToken`, `consumeToken(id, now) → boolean`, `invalidateUserTokens` |
| Roles | `syncRoles`, `getUserRoles`, `getRolePermissions`, `roleExists`, `addUserRole`, `removeUserRole`, `countActiveUsersWithRole` |
| Audit | `recordEvent` |

`RateLimitStore` (in `core/rate-limit.ts`) has two methods: `update(key, fn)` and `delete(key)`.

In Go the equivalents are `auth.Store` and `auth.RateLimitStore` in `internal/auth/store.go`, and `internal/store/storetest` holds shared tests every store must pass.

## The guarantees you must keep

| Guarantee | What it means in your store |
| --- | --- |
| Unique email | `createUser` must fail with an email-taken error when the normalized email exists, even under concurrency. Use a unique index |
| Atomic user creation | The user, its password hash and its default roles appear together or not at all |
| Single-use tokens | `consumeToken` must be a conditional update that returns `true` for exactly one caller |
| Atomic rate limits | `RateLimitStore.update` must be atomic across all app instances (row lock, compare-and-swap). A per-process map is only correct for one instance |
| Hashes only | Session and token hashes are stored, never the raw values |
| Last admin protection | `countActiveUsersWithRole` must count only active users |

## Steps

1. Read `src/auth/stores/memory.ts`: the smallest complete implementation.
2. Create `src/auth/stores/mystore.ts` implementing `AuthStore` (and, for several instances, `RateLimitStore`).
3. Select it in `src/db/store.ts`.
4. `createAuth` in `src/auth/index.ts` checks `adapter.database` against a list of databases it knows (`SUPPORTED_DATABASES`) and refuses anything else at startup. Extend that list in your copy, and keep your configuration's `adapter.database` and `adapter.orm` values valid for the schema check (`npx selfauth validate`).
5. Run the conformance suite against your app: the `@selfauth/conformance` package in the SelfAuth repository defines a driver contract. The reference apps (`apps/playground`) show how a driver starts an isolated instance of your app for each of the 90 cases.

The suite is how every shipped store is proven. See [Conformance and support](./conformance).
