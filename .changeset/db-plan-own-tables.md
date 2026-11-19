---
"@selfauth/cli": minor
"@selfauth/migration": minor
---

`selfauth db plan` no longer asks for approval when you create a table or add a column or index to your own tables. It used to report every change to a table outside SelfAuth's list as `not_owned` and refuse to migrate without `--approve-destructive`, which taught people to approve without reading. The ownership rule now works the way it was meant to: a migration SelfAuth ships may only change SelfAuth's tables (`not_owned` otherwise), a migration you write may change your own tables freely, and changing a SelfAuth table (`auth_…`) from your own migration is reported as the new `selfauth_table` finding. Statements that lose data (drops, type changes, renames, deletes) still need approval for every table. Every finding now prints a sentence saying what it means, and a locked or failed migration prints the tool's own output.
