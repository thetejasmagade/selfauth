---
"selfauth": patch
---

Fix `npm install` failing at once on Windows during `selfauth init`, `add` and `add-frontend`. Windows runs `npm`, `pnpm` and `yarn` as `.cmd` scripts, which Node cannot start without a shell, so the install never ran and no reason was shown. The commands now go through the shell with quoted arguments, and a failure says why.
