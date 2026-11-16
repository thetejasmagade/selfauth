# ADR 0018 — Templates are the reference implementations

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

ADR 0003 makes templates the source of truth for both CLI generation and
manual copying. Keeping a separate copy of the code as "templates" next to the
reference implementations that the conformance suite tests would let the two
drift: the generator would emit code that was never tested.

## Decision

1. **The template sources are the reference implementation files.**
   `packages/cli/src/registry.json` maps files in `apps/playground` (and,
   next, the frontends) to their paths in a generated project. The CLI copies
   them byte for byte; a test asserts it.
2. **Small, explicit seams** keep the shared files generic:
   `src/store.ts` (database), `src/mailer.ts` (email provider),
   `src/routes.ts` (application routes), `src/dev-config.ts`. Where a project
   needs something different from the playground, the registry points at a
   variant file in `packages/cli/template-variants/` (e.g. the in-memory
   `store.ts` and an example `routes.ts`).
3. **Rendered files** are generated from the user's answers: `package.json`
   (dependency versions copied from the tested reference apps), `tsconfig`,
   `.env.example`, `.gitignore`, `README.md`, `src/selfauth.config.ts`
   (validated by the spec schema) and `selfauth.manifest.json`.
4. **No runtime SelfAuth dependency in generated code**: each app keeps the
   spec types it needs in `src/auth/types.ts`; type-level tests keep them
   identical to `@selfauth/spec`.
5. **The manifest records every generated file** with its template id and the
   SHA-256 of the generated content, so `validate`/`doctor` (and the coming
   `diff`/`upgrade`, ADR 0004) can tell which files the developer changed.
6. **The build bundles template sources** into `dist/templates`, so the
   published CLI is self-contained and works offline.

## Consequences

- Whatever passes the conformance suite is exactly what users receive.
- Changing a reference file changes generated output; the template version
  in the manifest records which version a project came from.
- CI generates projects outside the monorepo, installs them from npm, runs
  migrations, boots them and exercises the API (`scripts/smoke-generated.sh`).
