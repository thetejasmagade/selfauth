#!/usr/bin/env node
/* eslint-disable no-console */
import { isMandatory, loadRequirements } from "@selfauth/spec";
import { computeCoverage } from "./coverage.js";
import { loadCases, loadVerification } from "./load.js";

const report = computeCoverage(
  await loadRequirements(),
  await loadCases(),
  await loadVerification(),
);
const mandatory = report.requirements.filter((r) => isMandatory(r.requirement));
const byCase = mandatory.filter((r) => r.cases.length > 0).length;
const byOther = mandatory.filter((r) => r.cases.length === 0 && r.verification.length > 0).length;

console.log(`Requirements: ${report.requirements.length} (${mandatory.length} mandatory)`);
console.log(`  covered by conformance cases:        ${byCase}`);
console.log(`  covered only by other verification:  ${byOther}`);
console.log(`  uncovered:                           ${report.uncovered.length}`);

if (process.argv.includes("--verbose")) {
  for (const r of report.requirements) {
    const how = [...r.cases, ...r.verification].join(", ") || "—";
    console.log(`${r.requirement.id.padEnd(18)} ${r.requirement.level.padEnd(10)} ${how}`);
  }
}

const problems = [
  ...report.uncovered.map((id) => `uncovered mandatory requirement ${id}`),
  ...report.unknownReferences.map((id) => `unknown requirement ${id}`),
  ...report.withdrawnReferences.map((id) => `withdrawn requirement referenced ${id}`),
  ...report.duplicateCaseIds.map((id) => `duplicate case id ${id}`),
  ...report.referenceErrors,
];
if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exitCode = 1;
}
