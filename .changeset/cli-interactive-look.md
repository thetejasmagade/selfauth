---
"@selfauth/cli": minor
---

A friendlier terminal experience. On a terminal, `selfauth init` starts with a banner, numbers its questions ("1/4 Backend"), shows a summary box of your choices with the files grouped by folder before it asks to create them, and highlights the commands in "Next steps". `selfauth --help` starts with the banner, and every command's ✓ ⚠ ✗ markers are coloured. Nothing changes when output is not a terminal (pipes, CI, `--yes`, `--dry-run`) or when `NO_COLOR` is set, so scripts and logs see the same plain text as before.
