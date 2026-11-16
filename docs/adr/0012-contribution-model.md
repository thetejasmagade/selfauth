# ADR 0012 — Contribution model

- **Status:** Accepted
- **Date:** 2026-11-16

## Decision

- Contributions are accepted via pull request under the project licence
  (ADR 0010), using the **Developer Certificate of Origin** (`git commit -s`)
  rather than a CLA.
- Security-sensitive areas (spec, password/session/token handling, migrations)
  require review by a maintainer, plus the conformance suite passing.
- AI-assisted contributions are welcome and follow the same rules plus the agent
  rules in `CONTRIBUTING.md`; the human submitting is accountable for them.
- New adapters are proposed with an issue first, and are merged as
  "experimental" until they reach Core compliance.
