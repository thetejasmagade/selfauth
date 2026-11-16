# Cursor

```bash
npx @selfauth/cli skill install --agent cursor
```

This writes `.cursor/skills/selfauth/`. Cursor's agent discovers skills at
startup. Type `/selfauth` in Agent chat to invoke it directly.

Cursor also reads `.claude/skills/`. If the project already has the Claude
Code install, Cursor picks it up, and a second copy isn't needed.

Projects that only use Cursor rules can add `.cursor/rules/selfauth.mdc`
instead:

```markdown
---
description: Authentication, sessions, roles and permissions
alwaysApply: false
---
For login, session, role or permission work, follow `.cursor/skills/selfauth/SKILL.md`.
Never hand-write authentication code; use the SelfAuth CLI.
```
