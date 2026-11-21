import { loadCases, runCase } from "@selfauth/conformance";
import { afterAll, describe, it } from "vitest";
import { flaskDriver } from "./driver.ts";
import { startHarness } from "./harness.ts";

/**
 * Runs every language-neutral conformance case (conformance/cases/*.json) against
 * the Flask reference application. The application is Python: each case gets an
 * isolated instance inside one harness process (test/harness/server.py), once per store.
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

describe.concurrent("SelfAuth conformance — Flask + in-memory store", () => {
  const driver = flaskDriver(harness.port, "memory");
  for (const c of cases) {
    it(`${c.id} [${c.level}] ${c.title}`, () => runCase(c, driver), 30_000);
  }
});

// SQLite needs no server, so it always runs. MySQL runs when TEST_MYSQL_URL names a server whose
// user may create databases (every case gets its own).
describe.concurrent("SelfAuth conformance — Flask + SQLite", () => {
  const driver = flaskDriver(harness.port, "sqlite");
  for (const c of cases) {
    it(`${c.id} [${c.level}] ${c.title}`, () => runCase(c, driver), 30_000);
  }
});

describe
  .runIf(process.env["TEST_MYSQL_URL"])
  .concurrent("SelfAuth conformance — Flask + MySQL", () => {
    const driver = flaskDriver(harness.port, "mysql");
    for (const c of cases) {
      it(`${c.id} [${c.level}] ${c.title}`, () => runCase(c, driver), 30_000);
    }
  });

describe
  .runIf(process.env["TEST_MONGODB_URL"])
  .concurrent("SelfAuth conformance — Flask + MongoDB", () => {
    const driver = flaskDriver(harness.port, "mongodb");
    for (const c of cases) {
      it(`${c.id} [${c.level}] ${c.title}`, () => runCase(c, driver), 30_000);
    }
  });

describe
  .runIf(TEST_DATABASE_URL)
  .concurrent("SelfAuth conformance — Flask + PostgreSQL", () => {
    const driver = flaskDriver(harness.port, "postgres");
    for (const c of cases) {
      it(`${c.id} [${c.level}] ${c.title}`, () => runCase(c, driver), 30_000);
    }
  });
