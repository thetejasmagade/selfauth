# 0022 — Conformance levels are computed from results and sign-offs

- Status: accepted
- Date: 2026-11-17

## Context

specs/CONFORMANCE.md defines three levels (core, authorization, production-profile) and says
an adapter must never be labelled production-ready because its generator runs. Until Phase 9
nothing computed a level, and the requirements proven by something other than a case (reviews,
documentation, schema and migration tests, static analysis) were listed but not tracked.

## Decision

- A level is **computed**, never written by hand: `evaluateLevels` takes the case results, the
  verification entries and the adapter's sign-offs.
- Each non-case check has a **sign-off** in `conformance/adapters/<adapter>.json`: a finding and
  evidence paths. A test fails when a sign-off is missing, duplicated, unknown, or cites a file
  that does not exist.
- The adapter record also holds the level it **publishes** for each store. CI fails when a store
  measures below it. The in-memory store is capped at `authorization` by policy.
- `docs/conformance.md` (support matrix, version compatibility, known limitations, coverage by area,
  sign-offs) is **generated** from the record and the cases, and a test fails when it drifts.
- Production-profile status is self-assessed until an independent audit exists. The record says so
  (`independentAudit: false`) and the generated document repeats it.

## Consequences

- Adding a requirement with a verification entry forces a sign-off, so the level drops until
  someone checks it.
- A reviewer's finding is auditable: it names the file or test. It is still the project's own
  word, which is why the 1.0 gate requires an outside review.
- Another adapter (Phase 10) adds its own record and gets the same checks.
