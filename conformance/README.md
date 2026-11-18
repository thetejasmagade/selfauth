# @selfauth/conformance

Language-neutral conformance cases for SelfAuth adapters, the runner that
executes them, and requirement-coverage tooling.

- `cases/*.json`: one case per behaviour, each tied to the requirement IDs it
  proves, for example "login is rate limited per account" or "a session can't
  be fixed by the client".
- `loadCases()`, `runCase(driver, case)` and the `Driver` interface: an
  adapter implements `Driver`, which is HTTP requests plus test-only views of
  time, mail, storage and logs. It then runs every case. The Express
  reference implementation passes all 90.
- `selfauth-coverage` (bin) reports every MUST requirement as covered by a
  case, covered by `verification.json`, or uncovered.

See `CONFORMANCE.md` in [`@selfauth/spec`](https://www.npmjs.com/package/@selfauth/spec)
and the [repository](https://github.com/thetejasmagade/selfauth).
