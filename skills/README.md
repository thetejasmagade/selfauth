# Agent skills

[`selfauth/`](selfauth/SKILL.md) is the `selfauth` skill for Claude Code,
Codex, Cursor and other [Agent Skills](https://agentskills.io) agents. It
makes agents inspect the project, read the specification, use the SelfAuth
CLI instead of hand-writing authentication code, and prove the result with
`scripts/validate-auth.ts` before they report completion. It also lets them
answer questions about SelfAuth (what it supports, how it works, its security
and limits) from the bundled files rather than from memory.

```text
selfauth/
  SKILL.md                       workflow and non-negotiable rules
  references/                    architecture, framework support, project layouts,
                                 migration rules, questions.md (question → answer
                                 → file), and the specifications and user guides
                                 (generated, see below)
  references/guides/             the user guides: usage, database, deployment, API
  scripts/detect-project.ts      wraps `selfauth detect --json`
  scripts/validate-auth.ts       validate + doctor + typecheck/test/build + live probes
  examples/                      new project, existing app, unsupported stack
```

Install it into a project with `selfauth skill install --agent claude|codex|cursor`.
See [integrations](../integrations/README.md).

## Development

- `references/{authentication-spec,authorization-spec,security-rules,configuration,errors}.md`
  are generated from `packages/spec/specs/`, and `references/guides/` from the
  user guides in `docs/` (links re-pointed, repository paths turned into plain
  text because an installed skill has no repository). Run
  `pnpm --filter @selfauth/skills sync` after changing a spec or a guide. The
  tests fail when they are stale.
- `references/questions.md` is hand-written: common questions, a short answer
  each, and the file with the detail. `test/questions.test.ts` asks 29 sample
  questions, follows each to its file and checks the facts are there, checks
  every reference is reachable from SKILL.md, and checks quoted defaults against
  the code. Add a sample when you add an answer.
- `pnpm --filter @selfauth/skills test` checks the skill against the CLI and
  the specification. The checks: every `selfauth …` command and flag it
  mentions exists, every requirement ID it cites is defined, every link
  resolves, framework support matches `selfauth list --json`, and the
  scripts behave correctly on fixture projects.
- The CLI bundles this directory at build time (`dist/skill/`), so the
  installed skill always matches that CLI's commands.
