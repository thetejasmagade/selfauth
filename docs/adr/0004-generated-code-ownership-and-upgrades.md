# ADR 0004 — Generated-code ownership and upgrade policy

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

Generated code is owned and modified by the application developer. Later
versions of SelfAuth will fix bugs and add features, and developers will want
those changes without losing their own edits.

## Decision

1. **Ownership.** Every file SelfAuth generates belongs to the application. The
   CLI never treats a generated file as "ours to replace".
2. **Manifest.** The CLI writes `selfauth.manifest.json` recording, per
   generated file and database resource: the template id, template version,
   spec version, and a content hash of what was generated. The manifest is
   metadata, not proof of non-modification.
3. **Upgrades are three-way.** `selfauth diff` and `selfauth upgrade` compare
   *original generated content* (re-rendered from the recorded template
   version), *current file*, and *new template output*:
   - unchanged by developer → may be updated after showing the diff;
   - changed by developer → never overwritten; a merge proposal or patch is
     produced for review;
   - ownership ambiguous (file missing from manifest, hash unknown) → ask.
4. **No silent writes.** Non-interactive mode only performs changes that would
   not prompt in interactive mode, unless an explicit flag (e.g.
   `--accept-conflicts=theirs`) names the behavior.
5. **No destructive schema changes** without explicit approval (see
   `DATA_MODEL.md` and the migration rules in Phase 4).
6. **Security fixes** are published as advisories with a patch that can be
   applied manually, because an application may never run `upgrade`.

## Consequences

- Templates must be versioned and old versions must remain renderable.
- The CLI needs a reliable diff/merge component — deferred to Phase 6.
