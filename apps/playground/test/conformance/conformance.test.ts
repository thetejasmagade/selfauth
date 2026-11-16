import { loadCases, runCase } from "@selfauth/conformance";
import { describe, it } from "vitest";
import { TEST_DATABASE_URL } from "../postgres.ts";
import { playgroundDriver } from "./driver.ts";

/**
 * Runs every language-neutral conformance case (conformance/cases/*.json)
 * against the Express reference implementation, once per store.
 */
const cases = await loadCases();

describe.concurrent("SelfAuth conformance — Express + in-memory store", () => {
  const driver = playgroundDriver("memory");
  for (const c of cases) {
    it(`${c.id} [${c.level}] ${c.title}`, () => runCase(c, driver), 30_000);
  }
});

describe
  .runIf(TEST_DATABASE_URL)
  .concurrent("SelfAuth conformance — Express + PostgreSQL (Prisma)", () => {
    const driver = playgroundDriver("postgres");
    for (const c of cases) {
      it(`${c.id} [${c.level}] ${c.title}`, () => runCase(c, driver), 30_000);
    }
  });
