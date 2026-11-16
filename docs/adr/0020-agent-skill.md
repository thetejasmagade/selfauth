# ADR 0020 — The `selfauth` agent skill

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Phase 7 lets coding agents (Claude Code, Codex, Cursor and others) add
SelfAuth without inventing security-sensitive code. The plan defines the
skill's responsibilities (inspect, detect, read the spec, check
compatibility, present a plan, use the CLI, integrate, validate, report) and
its safety rules. The risk is an agent that "helps" by hand-writing auth,
porting the Express code to an unsupported framework, or reporting success
it didn't check.

## Decision

1. **One skill, in the open Agent Skills format.** `skills/selfauth/SKILL.md`,
   with `references/`, `scripts/` and `examples/`. Claude Code, Codex and
   Cursor all read `SKILL.md` and differ only in the directory they scan.
   `selfauth skill install --agent claude|codex|cursor|all` copies the skill
   to `.claude/skills/`, `.agents/skills/` or `.cursor/skills/`. The CLI
   bundles the skill at build time, so the installed skill always matches that
   CLI's commands. Edited copies are kept unless `--update` is passed.
2. **The skill drives the CLI. It contains no auth logic.** Decisions an agent
   would otherwise guess at are CLI commands with JSON output, so they are
   tested once and shared by every agent:
   - `selfauth detect --json`: stack, database clients, unsupported
     frameworks and languages, auth packages, and file:line *auth signals*
     in the application's own source. It also returns a `recommendation`
     (`init | add | upgrade | unsupported`) and per-command blockers.
   - `--json` for `list`, `doctor` and `validate`.
3. **Scripts are thin and dependency-free.** `detect-project.ts` summarises
   `detect`. `validate-auth.ts` runs `validate`, `doctor`, the project's own
   typecheck/test/build (backend and `web/`), and, with `--url`, read-only
   live probes. The probes check that `/auth/me` and the developer's
   protected routes refuse anonymous requests and that CSRF is enforced. It
   prints `RESULT: PASS|FAIL` and lists every `SKIPPED` check, because the
   skill forbids claiming completion without `PASS` and requires reporting
   skips. Both run with plain `node` (type stripping, Node.js ≥ 22.18). They
   find the CLI through `$SELFAUTH_CLI`, the project's `node_modules`, or
   `npx`.
4. **References are the specification, not a paraphrase.** The
   authentication, authorization, security, configuration and error specs are
   copied into `references/` by `skills/scripts/sync-references.mjs`, with
   links rewritten. A test fails when they are stale. The architecture,
   framework-support and migration-rules references are hand-written and
   tested:
   - every requirement ID they cite exists;
   - every `selfauth` command and flag exists in the CLI;
   - every link and anchor resolves;
   - the framework-support table equals `selfauth list --json`.
5. **`validate` no longer passes what it did not check.** For a PostgreSQL
   project without Prisma installed, the schema check is now a problem, not
   an informational note. Otherwise "validate passed" would be a claim with
   nothing behind it.
6. **Acceptance runs in CI.** Each generated-project smoke job installs the
   skill and runs the *installed* scripts. `detect-project` must recommend
   the right command and `validate-auth --url … --protected …` must print
   `RESULT: PASS`. The `add` job uses `examples/existing-express-app`, a
   small API with its own tests. It applies the integration an agent makes
   (kept as a reviewable patch) and shows that the existing tests still pass
   and the new protected route refuses anonymous requests.

## Consequences

- Agents get the same answers as the CLI. A new adapter is reachable from
  the skill once `detect`/`list` report it, so the skill's prose never lists
  support the CLI doesn't have.
- The skill can't stop an agent that ignores it. The rules are written as
  non-negotiable, and the scripts make the honest path the easy one, but
  approval prompts are the agent tool's job.
- Generated projects don't have a test suite yet, so `validate-auth` reports
  `test` as SKIPPED for them. The live probes cover the auth wiring until
  generated projects ship tests.
