import { loadCases, runCase } from "@selfauth/conformance";
import { describe, it } from "vitest";
import { createPlaygroundDriver } from "./driver.ts";

/**
 * Runs every language-neutral conformance case (conformance/cases/*.json)
 * against the Express reference implementation.
 */
const cases = await loadCases();

describe.concurrent("SelfAuth conformance — Express reference implementation", () => {
  for (const c of cases) {
    it(`${c.id} [${c.level}] ${c.title}`, () => runCase(c, createPlaygroundDriver), 30_000);
  }
});
