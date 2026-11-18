import { loadCases, runCase } from "@selfauth/conformance";
import { afterAll, describe, it } from "vitest";
import { ginDriver } from "./driver.ts";
import { startHarness } from "./harness.ts";

/**
 * Runs every language-neutral conformance case (conformance/cases/*.json) against
 * the Gin reference application. The application is Go: each case gets an
 * isolated instance inside one harness process (test/harness), once per store.
 * Set SELFAUTH_REQUIRE_POSTGRES=1 (CI does) to fail instead of skipping when no
 * database is configured.
 */
const cases = await loadCases();
const harness = await startHarness();
afterAll(() => harness.close());

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
if (!TEST_DATABASE_URL && process.env["SELFAUTH_REQUIRE_POSTGRES"] === "1") {
  throw new Error("SELFAUTH_REQUIRE_POSTGRES=1 but TEST_DATABASE_URL is not set");
}

describe.concurrent("SelfAuth conformance — Gin + in-memory store", () => {
  const driver = ginDriver(harness.port, "memory");
  for (const c of cases) {
    it(`${c.id} [${c.level}] ${c.title}`, () => runCase(c, driver), 30_000);
  }
});

describe
  .runIf(TEST_DATABASE_URL)
  .concurrent("SelfAuth conformance — Gin + PostgreSQL (pgx)", () => {
    const driver = ginDriver(harness.port, "postgres");
    for (const c of cases) {
      it(`${c.id} [${c.level}] ${c.title}`, () => runCase(c, driver), 30_000);
    }
  });
