# ADR 0006 — MVP framework and database combinations

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

The MVP must be one complete, tested vertical slice rather than many partial
adapters.

## Decision

| Order | Layer | Adapter | Condition |
| --- | --- | --- | --- |
| 1 | Backend | Express 5 + TypeScript | Reference implementation (Phase 3) |
| 2 | Database | PostgreSQL + Prisma | First database path (Phase 4) |
| 3 | Frontend | Vue 3 | First frontend (Phase 5) |
| 4 | Frontend | React | Only if it does not delay the first stable slice |
| 5 | Database | MongoDB + Mongoose | After the PostgreSQL path is stable and conformance passes |

Adapters are composable (frontend × backend × database), not hard-coded
combinations. A combination is "supported" only when it has passing conformance
results (see `packages/spec/specs/CONFORMANCE.md`).

## Consequences

- The service layer of the reference implementation must be written against
  repository interfaces so the MongoDB adapter can reuse it.
- Everything else in Phase 10 of the roadmap waits for the conformance suite.
