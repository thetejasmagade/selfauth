# Claude Code

```bash
npx @selfauth/cli skill install --agent claude
```

This writes `.claude/skills/selfauth/`. Claude Code discovers project skills
at startup and uses `selfauth` when a request matches its description, for
example "add login to this app" or "protect the orders routes". You can also
invoke it directly with `/selfauth`.

For a personal install across all projects, run
`npx @selfauth/cli skill install --global --agent claude`, which writes
`~/.claude/skills/selfauth/`.

What the skill makes Claude do (see [SKILL.md](../skills/selfauth/SKILL.md)):

1. Run `scripts/detect-project.ts` and follow its recommendation.
2. Show you any existing authentication it finds, then ask.
3. Show you the CLI's `--dry-run` plan and the edits it will make to your
   files. Nothing runs before you approve.
4. Run the CLI, wire the result in, then run `scripts/validate-auth.ts`.
5. Report what was verified, what was skipped, and what is left for you to
   do.
