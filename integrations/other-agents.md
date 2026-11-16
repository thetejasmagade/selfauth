# Other agents

Any agent that supports Agent Skills can use the skill as-is. Copy
`skills/selfauth/` (or run `selfauth skill install --agent codex`, which
writes the vendor-neutral `.agents/skills/selfauth/`) to wherever the agent
discovers skills.

For agents without skills support, point their instruction file
(`AGENTS.md`, `CONVENTIONS.md`, a system prompt) at the skill:

```markdown
For authentication work, read and follow `.agents/skills/selfauth/SKILL.md`.
Use the SelfAuth CLI; never hand-write authentication code.
```

The skill needs:

- shell access, to run `node` and `npx @selfauth/cli`;
- Node.js ≥ 22.18, so the scripts' TypeScript runs without a build step;
- the ability to stop and ask the developer. The approval steps aren't
  optional, so a fully unattended agent should stop at them.
