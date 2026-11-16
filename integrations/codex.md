# Codex

```bash
npx @selfauth/cli skill install --agent codex
```

This writes `.agents/skills/selfauth/`, the repository skill location Codex
scans. Codex loads the skill's name and description up front and reads the
full `SKILL.md` when a task matches. You can also invoke it explicitly with
`$selfauth`.

If your Codex setup relies on `AGENTS.md` rather than skills, add this
paragraph to it:

```markdown
## Authentication
Use the SelfAuth skill in `.agents/skills/selfauth/SKILL.md` for any login,
session, role or permission work. Never hand-write authentication code; use
the SelfAuth CLI and follow the skill's rules and validation steps.
```

The CLI doesn't edit `AGENTS.md` for you.
