import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CATEGORIES,
  categoryCoverage,
  categoryOf,
  checkSignoffs,
  computeCoverage,
  evaluateLevels,
  loadAdapterRecord,
  loadCases,
  loadVerification,
  renderConformanceDoc,
  runSuite,
  type CaseResult,
} from "@selfauth/conformance";
import { loadRequirements, SPEC_VERSION } from "@selfauth/spec";
import { describe, expect, it } from "vitest";
import { ginDriver } from "./driver.ts";
import { startHarness } from "./harness.ts";

/**
 * Compliance levels for the Gin adapter (specs/CONFORMANCE.md): runs the suite per store, requires each store to
 * reach the level the adapter record publishes, and keeps docs/conformance-gin.md in step.
 */
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];

const [record, cases, verification, requirements] = await Promise.all([
  loadAdapterRecord(`${REPO}conformance/adapters/gin.json`),
  loadCases(),
  loadVerification(),
  loadRequirements(),
]);
const ORDER = ["none", "core", "authorization", "production"] as const;
const rank = (level: string) => ORDER.indexOf(level as (typeof ORDER)[number]);

describe("adapter record", () => {
  it("has a sign-off for every non-case check, with evidence that exists", () => {
    expect(checkSignoffs(record, verification, REPO)).toEqual([]);
  });

  it("targets the specification version in this repository", () => {
    // The specification has its own version; it does not follow the package's.
    expect(record.specVersion).toBe(SPEC_VERSION);
  });
});

describe("categories", () => {
  it("place every requirement in exactly one area", () => {
    const orphans = requirements.filter((r) => !categoryOf(r.id)).map((r) => r.id);
    expect(orphans).toEqual([]);
    const prefixes = CATEGORIES.flatMap((c) => c.prefixes);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("cover every mandatory requirement", () => {
    const report = computeCoverage(requirements, cases, verification);
    expect(report.uncovered).toEqual([]);
    for (const c of categoryCoverage(requirements, cases, verification)) {
      expect(c.byCases + c.byOtherVerification, c.category.title).toBe(c.mandatory);
    }
  });
});

describe("evaluateLevels", () => {
  const passing: CaseResult[] = cases.map((c) => ({
    id: c.id,
    title: c.title,
    category: c.category,
    level: c.level,
    passed: true,
  }));
  const input = { cases, results: passing, verification, signoffs: record.signoffs };

  it("reaches production only with every case passing and every item signed off", () => {
    expect(evaluateLevels(input).achieved).toBe("production");
  });

  it("drops to core when an authorization case fails", () => {
    const failing = passing.map((r) =>
      r.level === "authorization" ? { ...r, passed: false, error: "x" } : r,
    );
    expect(evaluateLevels({ ...input, results: failing }).achieved).toBe("core");
  });

  it("stops below core when a core case fails", () => {
    const failing = passing.map((r, i) =>
      i === 0 && r.level === "core" ? { ...r, passed: false } : r,
    );
    const first = cases.findIndex((c) => c.level === "core");
    failing[first] = { ...failing[first]!, passed: false };
    expect(evaluateLevels({ ...input, results: failing }).achieved).toBe("none");
  });

  it("is not production without the review sign-offs, however many cases pass", () => {
    const withoutReviews = record.signoffs.filter((s) => s.method !== "code-review");
    expect(evaluateLevels({ ...input, signoffs: withoutReviews }).achieved).toBe("authorization");
  });

  it("is not core without a sign-off for an automated check", () => {
    const withoutTests = record.signoffs.filter((s) => s.method !== "adapter-test");
    expect(evaluateLevels({ ...input, signoffs: withoutTests }).achieved).toBe("none");
  });
});

describe.each([
  ["memory", true],
  ["postgresql", Boolean(TEST_DATABASE_URL)],
] as const)("published level — %s store", (store, available) => {
  it.runIf(available)(
    "measures at least the level the adapter record publishes",
    async () => {
      const harness = await startHarness();
      try {
        const results = await runSuite(
          cases,
          ginDriver(harness.port, store === "memory" ? "memory" : "postgres"),
        );
        const failed = results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.error}`);
        expect(failed).toEqual([]);
        const { achieved } = evaluateLevels({
          cases,
          results,
          verification,
          signoffs: record.signoffs,
        });
        expect(rank(achieved)).toBeGreaterThanOrEqual(rank(record.claims[store]!));
      } finally {
        await harness.close();
      }
    },
    120_000,
  );
});

describe("docs/conformance-gin.md", () => {
  const goMod = readFileSync(`${REPO}apps/playground-gin/go.mod`, "utf8");
  const version = (name: string) => new RegExp(`${name} (v[0-9][^\\s]*)`).exec(goMod)?.[1] ?? "?";
  const compat = () => [
    { name: "Go", range: /^go (\S+)/m.exec(goMod)?.[1] ?? "?", note: "the version in go.mod" },
    { name: "Gin", range: version("github.com/gin-gonic/gin"), note: "Gin 1.x" },
    { name: "pgx", range: version("github.com/jackc/pgx/v5"), note: "PostgreSQL store" },
    { name: "PostgreSQL", range: "16", note: "tested in CI" },
    { name: "Node.js", range: ">=22.18", note: "only for the SelfAuth CLI" },
    { name: "Specification", range: record.specVersion },
  ];

  it("is generated from the record, the cases and the tested versions", () => {
    const text = renderConformanceDoc({
      record,
      cases,
      coverage: categoryCoverage(requirements, cases, verification),
      compatibility: compat(),
      reportTest: "apps/playground-gin/test/conformance/report.test.ts",
      testPackage: "@selfauth/playground-gin",
    });
    const file = `${REPO}docs/conformance-gin.md`;
    if (process.env["UPDATE_CONFORMANCE_DOC"]) writeFileSync(file, text);
    expect(readFileSync(file, "utf8")).toBe(text);
  });
});
