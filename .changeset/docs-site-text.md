---
"@selfauth/cli": patch
---

Fix stale help text: `selfauth init --help` and `selfauth list` now say the generated frontend is in `client/` (not `web/`), and `list` no longer calls MongoDB planned.
