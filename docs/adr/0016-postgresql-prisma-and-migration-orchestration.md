# ADR 0016 — PostgreSQL via Prisma 7, and migration orchestration

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Phase 4 delivers the first database adapter (PostgreSQL + Prisma, ADR 0006)
and the migration architecture: SelfAuth must orchestrate native tools, never
replace them, and never change a schema without review (DATA-MODEL-003/004).

## Decision

1. **Prisma 7.10 (stable)** with the `prisma-client` generator and the
   `@prisma/adapter-pg` driver adapter. npm's `latest` tag currently points at
   an 8.0 release candidate; we pin the stable 7.x line.
2. The generated client lives in the application (`src/generated/prisma`),
   is git-ignored, and is produced by a Turborepo `generate` task before
   build, typecheck and test. pnpm is allowed to run install scripts only for
   `prisma` and `@prisma/engines` (`onlyBuiltDependencies`).
3. **Atomicity in the database** (DATA-MODEL-002): user creation is one
   transaction; token consumption and session revocation are conditional
   `updateMany`; rate-limit updates lock their row with `SELECT … FOR UPDATE`,
   so limits hold across application instances (SEC-RATE-006).
4. **Role sync never prunes.** Configured roles and permissions are upserted
   and made exact; roles removed from configuration are kept until a reviewed
   migration removes them, so users never silently lose access.
5. **`@selfauth/migration`** defines the adapter contract (inspect, status,
   plan, generate, migrate, validate, rollback) and a Prisma implementation
   that drives `prisma migrate`. Before applying, it:
   - flags destructive SQL (drops, truncates, deletes, type changes, renames)
     and any change to objects not in `selfauth.manifest.json` — these need
     explicit approval;
   - detects objects a pending migration would create that already exist —
     these block even with approval;
   - explains Prisma's baselining requirement (P3005) for existing databases
     without Prisma history.
   It uses `migrate deploy` (committed migrations only, no resets) and reports
   that rollback is not automatic, with recovery guidance.
6. **Tests isolate by schema**: each test applies the committed migrations to
   a fresh PostgreSQL schema, so the conformance suite runs concurrently.
   CI runs a `postgres:16` service and sets `SELFAUTH_REQUIRE_POSTGRES=1` so
   database tests can never be skipped silently.

## Consequences

- The same 87 conformance cases pass on the in-memory and PostgreSQL stores.
- Integrating into a database that has tables but no Prisma history requires
  a baseline step first; the Phase 6 CLI should automate it.
- MongoDB + Mongoose follows once this path is stable (ADR 0006).
