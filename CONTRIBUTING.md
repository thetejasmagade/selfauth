# Contributing to SelfAuth

Thanks for helping. SelfAuth generates security-sensitive code that other
people will run in production, so the bar for correctness is high and the
process is deliberate.

## Before you start

1. Read [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`DECISIONS.md`](DECISIONS.md).
2. For behavior changes, read the relevant spec in
   [`packages/spec/specs/`](packages/spec/specs/).
3. For anything larger than a bug fix, open an issue first. New adapters always
   start with an issue.

## Development setup

```bash
corepack enable
pnpm install
pnpm check
```

Useful commands: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`,
`pnpm format`.

## Pull requests

- Keep PRs small and focused, with explicit acceptance criteria in the
  description.
- Add tests, including **negative security cases** (wrong password, expired
  token, replayed token, missing permission, …).
- Changing a requirement? Update the spec, the conformance cases or
  `conformance/verification.json`, and bump `specVersion` if needed
  (ADR 0011). CI rejects uncovered `MUST` requirements.
- Changing architecture? Add an ADR (ADR 0001).
- Changing a published package? Add a changeset: `pnpm changeset`.
- Sign off your commits (`git commit -s`) to certify the
  [Developer Certificate of Origin](https://developercertificate.org/).
- Template contributions are distributed under both Apache-2.0 and 0BSD
  (ADR 0010).

## Writing specification requirements

Format (ADR 0007):

```markdown
- **[AUTHN-LOGIN-001]** (MUST) Login MUST ...
```

- IDs are stable and never reused; withdraw with `(WITHDRAWN)`.
- Describe operations and outcomes, not framework APIs.
- Specify success, failure, expiry, and replay behavior for every
  security-sensitive flow.

## Rules for AI coding agents

These apply to Claude Code, Codex, Cursor, and any other agent contributing to
this repository.

Non-negotiable:

1. Generated authentication belongs to the target project.
2. No mandatory SelfAuth runtime service is allowed.
3. Never invent custom cryptography.
4. Use established framework and security libraries.
5. Never overwrite application code without review.
6. Never run destructive database migrations without explicit approval.
7. Keep the core specification language-neutral.
8. Keep framework-specific behavior inside adapters.
9. Every security-sensitive feature requires tests.
10. Never claim a feature is complete without validation.

Workflow: read the relevant docs → inspect the existing implementation →
identify affected packages → present a concise plan → implement the smallest
complete vertical slice → add tests including negative security cases → run
`pnpm check` → update docs → report files changed, tests run, limitations, and
outstanding decisions.

Do not independently change product architecture. If a requirement conflicts
with the specification, stop and explain the conflict.

## Code of conduct

Be respectful and constructive. Harassment or discrimination of any kind is not
tolerated; maintainers may remove content or contributors that violate this.
