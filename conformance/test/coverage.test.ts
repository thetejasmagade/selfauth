import { isMandatory, loadRequirements } from "@selfauth/spec";
import { describe, expect, it } from "vitest";
import {
  checkCaseReferences,
  computeCoverage,
  loadCases,
  loadVerification,
  type ConformanceCase,
} from "../src/index.js";

const [requirements, cases, verification] = await Promise.all([
  loadRequirements(),
  loadCases(),
  loadVerification(),
]);
const report = computeCoverage(requirements, cases, verification);

describe("conformance suite (ADR 0007 coverage rule)", () => {
  it("loads valid case files", () => {
    expect(cases.length).toBeGreaterThan(50);
  });

  it("covers every mandatory requirement with a case or a verification method", () => {
    expect(report.uncovered).toEqual([]);
  });

  it("covers most mandatory requirements with executable cases", () => {
    const mandatory = report.requirements.filter((r) => isMandatory(r.requirement));
    const byCase = mandatory.filter((r) => r.cases.length > 0);
    expect(byCase.length / mandatory.length).toBeGreaterThan(0.75);
  });

  it("references only defined, non-withdrawn requirements", () => {
    expect(report.unknownReferences).toEqual([]);
    expect(report.withdrawnReferences).toEqual([]);
  });

  it("uses unique case IDs", () => {
    expect(report.duplicateCaseIds).toEqual([]);
  });

  it("only uses saved values and fixtures after they exist", () => {
    expect(report.referenceErrors).toEqual([]);
  });

  it("does not list a requirement twice in verification.json", () => {
    const ids = verification.map((v) => v.requirement);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it("names each case's category after its file", () => {
    const mismatched = cases.filter((c) => `${c.category}.json` !== c.file).map((c) => c.id);
    expect(mismatched).toEqual([]);
  });

  it("only applies config overrides that are valid partial SelfAuth configuration keys", () => {
    const allowed = new Set(["authentication", "authorization", "http"]);
    const bad = cases
      .filter((c) => c.config && Object.keys(c.config).some((k) => !allowed.has(k)))
      .map((c) => c.id);
    expect(bad).toEqual([]);
  });
});

describe("computeCoverage", () => {
  const req = (id: string, level: "MUST" | "SHOULD", withdrawn = false) => ({
    id,
    level,
    withdrawn,
    text: "",
    source: "X.md",
    line: 1,
  });

  it("reports uncovered mandatory requirements, unknown and withdrawn references", () => {
    const result = computeCoverage(
      [
        req("A-B-001", "MUST"),
        req("A-B-002", "SHOULD"),
        req("A-B-003", "MUST", true),
        req("A-B-004", "MUST"),
      ],
      [
        {
          id: "CT-X-001",
          title: "t",
          category: "x",
          level: "core",
          requirements: ["A-B-003", "Z-Z-999"],
          given: [],
          steps: [{ op: "login" }],
        },
      ],
      [{ requirement: "A-B-004", methods: ["code-review"], how: "reviewed by a human" }],
    );
    expect(result.uncovered).toEqual(["A-B-001"]);
    expect(result.unknownReferences).toEqual(["Z-Z-999"]);
    expect(result.withdrawnReferences).toEqual(["A-B-003"]);
  });
});

describe("checkCaseReferences", () => {
  const base: ConformanceCase = {
    id: "CT-TEST-001",
    title: "t",
    category: "test",
    level: "core",
    requirements: ["AUTHN-LOGIN-001"],
    given: [{ user: "alice", email: "a@example.test", password: "p", state: "active" }],
    steps: [],
  };

  it("accepts fixture references and saved values", () => {
    expect(
      checkCaseReferences({
        ...base,
        steps: [
          { op: "readLastEmail", input: { to: "a@example.test" }, save: "mail" },
          { op: "verifyEmail", input: { token: "$mail.token", user: "$alice.id" } },
        ],
      }),
    ).toEqual([]);
  });

  it("rejects use before save, unknown comparisons and double saves", () => {
    expect(
      checkCaseReferences({
        ...base,
        steps: [
          { op: "verifyEmail", input: { token: "$mail.token" } },
          { op: "login", save: "x" },
          {
            op: "login",
            save: "x",
            expect: { outcome: "error", code: "INVALID_CREDENTIALS", indistinguishableFrom: "y" },
          },
        ],
      }),
    ).toHaveLength(3);
  });

  it("treats $config references as always available", () => {
    expect(
      checkCaseReferences({
        ...base,
        steps: [
          {
            op: "readLastEmail",
            input: { to: "a@example.test" },
            expect: { outcome: "success", assert: { link: "$config.appBaseUrl" } },
          },
        ],
      }),
    ).toEqual([]);
  });
});
