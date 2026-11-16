# Examples

- [`existing-express-app/`](existing-express-app/): a small Express +
  TypeScript shop API with its own tests, *before* SelfAuth. It is the sample
  project for the agent skill's acceptance test. CI copies it outside the
  repository, runs the installed skill's `detect-project.ts`, runs
  `selfauth add`, and applies
  [`existing-express-app.selfauth.patch`](existing-express-app.selfauth.patch).
  The patch holds the edits an agent makes: wiring, one protected route, a
  test for it, the `tsconfig` option, and `.env` loading. CI then requires the
  app's existing tests and `validate-auth.ts` to pass (`scripts/smoke-generated.sh memory add`).

Full-stack examples come from `selfauth init --frontend vue|react`; the
reference apps are `apps/playground*`.
