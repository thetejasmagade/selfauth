import { loadCases, runCase } from "@selfauth/conformance";
import { afterAll, describe, it } from "vitest";
import { ginDriver } from "./driver.ts";
import { startHarness } from "./harness.ts";

/**
 * Runs every language-neutral conformance case (conformance/cases/*.json) against
 * the Gin reference application. The application is Go: each case gets an
 * isolated instance inside one harness process (test/harness).
 */
const cases = await loadCases();
const harness = await startHarness();
afterAll(() => harness.close());

describe.concurrent("SelfAuth conformance — Gin + in-memory store", () => {
  const driver = ginDriver(harness.port);
  for (const c of cases) {
    it(`${c.id} [${c.level}] ${c.title}`, () => runCase(c, driver), 30_000);
  }
});
