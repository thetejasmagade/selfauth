---
title: selfauth skill
description: Install the selfauth skill so Claude Code, Codex or Cursor use the SelfAuth commands instead of writing authentication code. Options, where files go and how to update.
keywords: [selfauth skill, claude code, codex, cursor, agent skill, ai agent, SKILL.md]
---

# `selfauth skill install`

The skill teaches a coding agent to use the SelfAuth CLI instead of inventing its own authentication code. It's optional. The CLI and the generated code work fine without any AI.

```text
selfauth skill install [dir] [options]
```

| Option | Values | Default | Meaning |
| --- | --- | --- | --- |
| `--agent <list>` | `claude`, `codex`, `cursor`, `all` (comma-separated) | `claude` | Which agents to install for |
| `-g`, `--global` | – | – | Install into your home folder instead of a project, so every project has the skill. Don't pass `[dir]` with it |
| `--update` | – | – | Replace skill files that differ from this CLI's version |
| `--dry-run` | – | – | Show what would be written |

## Where files go

| Agent | Folder |
| --- | --- |
| Claude Code | `.claude/skills/selfauth/` |
| Codex | `.agents/skills/selfauth/` |
| Cursor | `.cursor/skills/selfauth/` |

```bash
npx selfauth skill install --agent claude
```

With `--global`, the same folders are created under your home folder (`~/.claude/skills/selfauth/`, `~/.agents/skills/selfauth/`, `~/.cursor/skills/selfauth/`), and only your machine gets the skill. For a project install, commit the folder so your whole team's agents use it. After upgrading the CLI, run `selfauth skill install --agent … --update` to keep the skill in step with the new commands.

[Use the AI skill](/ai-skill/) explains what the skill makes the agent do and how to prompt it.
