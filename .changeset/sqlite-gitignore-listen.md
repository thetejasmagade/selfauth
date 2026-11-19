---
"@selfauth/cli": patch
---

Generated projects now ignore SQLite database files (`*.db`, `*-journal`, `*-shm`, `*-wal`) in `.gitignore`, so a development database is never committed. The Express server now reports a failed start (for example "Could not start on port 3000: … address already in use") and exits with code 1, instead of printing "Listening" and quitting. `selfauth db migrate` now prints the migration tool's own output when a migration fails, and explains a locked SQLite database (stop the running server, then migrate).
