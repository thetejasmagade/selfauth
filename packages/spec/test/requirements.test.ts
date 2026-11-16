import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  SPEC_FILES,
  findRequirementReferences,
  isMandatory,
  loadRequirements,
  parseRequirements,
  readSpecFile,
} from "../src/index.js";

describe("parseRequirements", () => {
  it("parses definitions, levels, continuation lines and withdrawn markers", () => {
    const md = [
      "- **[AUTHN-TEST-001]** (MUST) First line",
      "  continues here.",
      "- **[AUTHN-TEST-002]** (MUST NOT) Never do this.",
      "- **[AUTHN-TEST-003]** (SHOULD) (WITHDRAWN) Old rule.",
      "",
      "Plain text mentioning [AUTHN-TEST-001].",
    ].join("\n");
    const reqs = parseRequirements(md, "X.md");
    expect(reqs.map((r) => [r.id, r.level, r.withdrawn])).toEqual([
      ["AUTHN-TEST-001", "MUST", false],
      ["AUTHN-TEST-002", "MUST NOT", false],
      ["AUTHN-TEST-003", "SHOULD", true],
    ]);
    expect(reqs[0]!.text).toBe("First line continues here.");
    expect(reqs[0]!.line).toBe(1);
    expect(isMandatory(reqs[1]!)).toBe(true);
    expect(isMandatory(reqs[2]!)).toBe(false);
  });

  it("finds references", () => {
    expect(findRequirementReferences("see [SEC-HASH-001] and [AUTHZ-CORE-004]")).toEqual([
      "SEC-HASH-001",
      "AUTHZ-CORE-004",
    ]);
  });
});

describe("bundled specification", async () => {
  const requirements = await loadRequirements();
  const ids = new Set(requirements.map((r) => r.id));

  it("defines a substantial set of requirements", () => {
    expect(requirements.length).toBeGreaterThan(100);
  });

  it("has unique requirement IDs", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const r of requirements) {
      if (seen.has(r.id)) duplicates.push(`${r.id} (${seen.get(r.id)} and ${r.source}:${r.line})`);
      seen.set(r.id, `${r.source}:${r.line}`);
    }
    expect(duplicates).toEqual([]);
  });

  it("only references requirement IDs that exist", async () => {
    const dangling: string[] = [];
    for (const file of SPEC_FILES) {
      for (const ref of findRequirementReferences(await readSpecFile(file))) {
        if (!ids.has(ref)) dangling.push(`${file}: ${ref}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it("uses the declared level keyword in each requirement's text", () => {
    const mismatched = requirements
      .filter((r) => !r.withdrawn && !r.text.includes(r.level))
      .map((r) => `${r.id} (${r.level})`);
    expect(mismatched).toEqual([]);
  });

  it("documents exactly the exported error codes in ERRORS.md", async () => {
    const md = await readSpecFile("ERRORS.md");
    const documented = [...md.matchAll(/^\| `([A-Z_]+)` \| (\d{3}) \|/gm)].map((m) => [
      m[1],
      Number(m[2]),
    ]);
    expect(documented).toEqual(ERROR_CODES.map((c) => [c, ERROR_HTTP_STATUS[c]]));
  });
});
