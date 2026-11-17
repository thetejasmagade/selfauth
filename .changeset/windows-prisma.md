---
"@selfauth/migration": patch
"@selfauth/cli": patch
"@selfauth/spec": patch
"@selfauth/conformance": patch
"selfauth": patch
---

`selfauth db …` now works on Windows. It ran Prisma through `node_modules/.bin/prisma`, a shell script that
Windows cannot execute, so `selfauth db plan` failed with an empty message (`prisma migrate status
failed:`). The CLI now starts Prisma's entry script with Node, which works everywhere, finds Prisma in a
parent folder (npm workspaces hoist it), and says what is wrong when Prisma is not installed or the
process cannot start, instead of an empty message.
