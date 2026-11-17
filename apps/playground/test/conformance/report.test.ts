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
import { loadRequirements } from "@selfauth/spec";
import { describe, expect, it } from "vitest";
import { TEST_DATABASE_URL } from "../postgres.ts";
import { playgroundDriver } from "./driver.ts";

/**
 * Compliance levels (specs/CONFORMANCE.md): runs the suite per store, requires each store to
 * reach the level the adapter record publishes, and keeps docs/conformance.md in step.
 */
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(`${REPO}${path}`, "utf8"));

const [record, cases, verification, requirements] = await Promise.all([
  loadAdapterRecord(`${REPO}conformance/adapters/express.json`),
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
    expect(record.specVersion).toBe(
      read("packages/spec/package.json").version.replace(/\.\d+$/, ""),
    );
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
      const results = await runSuite(
        cases,
        playgroundDriver(store === "memory" ? "memory" : "postgres"),
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
    },
    120_000,
  );
});

describe("docs/conformance.md", () => {
  const compat = () => {
    const playground = read("apps/playground/package.json");
    const deps = { ...playground.dependencies, ...playground.devDependencies };
    return [
      { name: "Node.js", range: ">=22.18", note: "type stripping for generated scripts" },
      { name: "Express", range: deps["express"], note: "Express 5 only" },
      {
        name: "TypeScript",
        range: read("package.json").devDependencies.typescript,
        note: ">= 5.7 in your project",
      },
      { name: "Prisma", range: deps["prisma"] ?? deps["@prisma/client"], note: "PostgreSQL store" },
      { name: "PostgreSQL", range: "16", note: "tested in CI" },
      { name: "Vue", range: read("apps/playground-vue/package.json").dependencies.vue },
      { name: "React", range: read("apps/playground-react/package.json").dependencies.react },
      { name: "Specification", range: record.specVersion },
    ];
  };

  it("is generated from the record, the cases and the tested versions", () => {
    const text = renderConformanceDoc({
      record,
      cases,
      coverage: categoryCoverage(requirements, cases, verification),
      compatibility: compat(),
    });
    const file = `${REPO}docs/conformance.md`;
    if (process.env["UPDATE_CONFORMANCE_DOC"]) writeFileSync(file, text);
    expect(readFileSync(file, "utf8")).toBe(text);
  });
});
