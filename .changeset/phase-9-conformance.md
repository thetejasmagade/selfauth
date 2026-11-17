---
"@selfauth/cli": minor
"@selfauth/conformance": minor
"@selfauth/spec": minor
"@selfauth/migration": minor
"selfauth": minor
---

Conformance levels and quality gates.

- `@selfauth/conformance`: `runSuite`, `evaluateLevels` and the adapter record (compliance levels with
  evidence-backed sign-offs), requirement areas, and a generated support-matrix document.
- `selfauth init` projects now include a smoke test suite (`npm test`, Node's built-in runner, no extra
  dependencies) that exercises the project's own authentication wiring.
- The Express adapter refuses configuration it cannot honour (for example MongoDB), at start-up.
- Documentation: data retention after account deletion, security review, HTTPS and HSTS.
