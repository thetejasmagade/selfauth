# ADR 0001 — Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

SelfAuth is security-sensitive, multi-language in the long run, and is meant to
be developed by humans and AI coding agents. Undocumented decisions get
re-litigated, or silently reversed by a contributor who did not know the reason.

## Decision

Every architecturally significant choice is recorded as an ADR in `docs/adr/`,
numbered sequentially, using `0000-template.md`. `DECISIONS.md` at the
repository root is the index.

An ADR is never edited to change its decision after it is Accepted. A new ADR
supersedes it, and the old one is marked `Superseded by ADR-XXXX`.

A change that conflicts with an Accepted ADR must either add a superseding ADR in
the same pull request or be rejected.

## Consequences

- Agents and contributors have a single place to check before changing
  architecture (see the agent rules in `CONTRIBUTING.md`).
- Small cost per decision; reviewers must ask "does this need an ADR?".
