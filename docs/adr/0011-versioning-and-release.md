# ADR 0011 — Versioning and release strategy

- **Status:** Accepted
- **Date:** 2026-11-16

## Decision

- **Packages** follow semantic versioning, managed with Changesets. Every PR that
  changes a published package includes a changeset.
- **`0.x`**: APIs and adapter behavior may change; breaking changes are listed
  in changelogs.
- **`1.0`**: stable core specification, CLI contracts, and supported adapter
  behavior. After 1.0, breaking changes require a major version and migration
  notes.
- **Specification** carries its own `specVersion` (`MAJOR.MINOR`). A minor bump
  adds requirements that are optional or backwards compatible; a major bump
  changes or tightens existing mandatory behavior.
- **Templates** are versioned with the CLI that ships them; the manifest records
  template and spec versions (ADR 0004).
- **Security releases** may be published out of cadence and are announced
  through GitHub Security Advisories.
