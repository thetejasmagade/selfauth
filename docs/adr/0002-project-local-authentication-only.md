# ADR 0002 — Project-local authentication is the only supported model

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Authentication products are usually hosted identity providers. SelfAuth's
premise is the opposite: the application owns its authentication code, data,
and runtime behavior.

## Decision

1. SelfAuth produces authentication and authorization code that runs **inside
   the target application**, against the application's own database.
2. Generated applications MUST NOT depend at runtime on any SelfAuth-operated
   service, network endpoint, licence check, telemetry endpoint, or the
   availability of the SelfAuth repository, CLI, or npm registry.
3. Any optional integration with a third party (for example a breached-password
   API or an email provider) is configured by the developer, off by default when
   it sends user data off-host, and has a local fallback.
4. Hosted identity, central auth servers, cross-application SSO, hosted user
   databases, and dashboards are out of scope (see `ARCHITECTURE.md`).

## Consequences

- Each adapter must be complete on its own; we cannot fix bugs centrally at
  runtime. This raises the bar for conformance testing and for upgrade tooling
  (ADR 0004).
- The CLI may use the network at **development time** (e.g. to install packages
  the developer approved), never at application runtime.

## Alternatives considered

- *Hosted service with self-host option* — contradicts the core promise and
  creates a runtime dependency.
- *Runtime SDK fetched at startup* — same problem, plus supply-chain risk.
