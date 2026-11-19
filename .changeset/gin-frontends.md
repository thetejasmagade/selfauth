---
"@selfauth/cli": minor
---

`selfauth init --backend gin --frontend vue|react` now works. The Go module goes in `server/` next to the frontend in `client/`, with a thin npm root (`npm run dev` starts both, `db:*`, `build`, `typecheck` and `test` wrap the Go commands) and a `scripts/dev-server.mjs` that loads `server/.env` for the Go server. `doctor`, `validate`, `diff`, `upgrade` and `db` work on it. The browser end-to-end suite now also runs against the Go server for both frontends.
