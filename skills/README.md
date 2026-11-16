# Agent skills

[`selfauth/`](selfauth/SKILL.md) is the `selfauth` skill for Claude Code,
Codex, Cursor and other [Agent Skills](https://agentskills.io) agents. It
makes agents inspect the project, read the specification, use the SelfAuth
CLI instead of hand-writing authentication code, and prove the result with
`scripts/validate-auth.ts` before they report completion.

```text
selfauth/
  SKILL.md                       workflow and non-negotiable rules
  references/                    architecture, framework support, migration rules,
                                 and the specifications (generated, see below)
  scripts/detect-project.ts      wraps `selfauth detect --json`
  scripts/validate-auth.ts       validate + doctor + typecheck/test/build + live probes
  examples/                      new project, existing app, unsupported stack
```

Install it into a project with `selfauth skill install --agent claude|codex|cursor`.
See [integrations](../integrations/README.md).

## Development

- `references/{authentication-spec,authorization-spec,security-rules,configuration,errors}.md`
  are generated from `packages/spec/specs/`. Run `pnpm --filter @selfauth/skills sync`
  after changing a spec. The tests fail when they are stale.
- `pnpm --filter @selfauth/skills test` checks the skill against the CLI and
  the specification. The checks: every `selfauth …` command and flag it
  mentions exists, every requirement ID it cites is defined, every link
  resolves, framework support matches `selfauth list --json`, and the
  scripts behave correctly on fixture projects.
- The CLI bundles this directory at build time (`dist/skill/`), so the
  installed skill always matches that CLI's commands.
