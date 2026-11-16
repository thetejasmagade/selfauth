# Agent integrations

One skill, [`skills/selfauth`](../skills/selfauth/SKILL.md), serves every
agent that supports the [Agent Skills](https://agentskills.io) `SKILL.md`
format. The CLI ships a copy that matches its own commands and installs it
where each agent looks:

```bash
npx @selfauth/cli skill install --agent claude   # .claude/skills/selfauth/
npx @selfauth/cli skill install --agent codex    # .agents/skills/selfauth/
npx @selfauth/cli skill install --agent cursor   # .cursor/skills/selfauth/
npx @selfauth/cli skill install --agent all
```

| Agent | Guide |
| --- | --- |
| Claude Code | [claude-code.md](claude-code.md) |
| Codex | [codex.md](codex.md) |
| Cursor | [cursor.md](cursor.md) |
| Others | [other-agents.md](other-agents.md) |

Commit the installed directory so the whole team's agents use it. After
upgrading the CLI, run `selfauth skill install --agent … --update` so the
skill matches the new commands.

The skill's scripts run with plain `node` (Node.js ≥ 22.18). They use the
CLI installed in the project (`node_modules/@selfauth/cli`), or `npx
@selfauth/cli`. Set `SELFAUTH_CLI=/path/to/selfauth/packages/cli/dist/bin.js`
to use a local build of this repository.
