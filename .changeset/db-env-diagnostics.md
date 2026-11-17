---
"@selfauth/cli": patch
"@selfauth/migration": patch
"@selfauth/spec": patch
"@selfauth/conformance": patch
"selfauth": patch
---

`selfauth db` now explains a missing `DATABASE_URL` instead of ending in Prisma's bare "Connection url is
empty". It reads the environment and the project's `.env` itself (tolerating CRLF line endings, a byte-order
mark and quotes), hands the value to Prisma explicitly, ignores an empty shell variable that would hide
`.env`, and reports what it found, where it looked, and when the value is the `.env.example` placeholder
or not a PostgreSQL URL. The database guide gains a troubleshooting section (URL-encoding passwords, and
using a direct or session-mode connection for migrations on Supabase and other pooled databases).
