import { isMandatory, type Requirement } from "@selfauth/spec";
import type { ConformanceCase, Step, VerificationEntry } from "./schema.js";

export interface RequirementCoverage {
  requirement: Requirement;
  cases: string[];
  verification: VerificationEntry["methods"];
}

export interface CoverageReport {
  requirements: RequirementCoverage[];
  /** Mandatory requirements with neither a case nor a verification entry. */
  uncovered: string[];
  /** IDs referenced by cases/verification that the spec does not define. */
  unknownReferences: string[];
  /** IDs referenced that the spec marks withdrawn. */
  withdrawnReferences: string[];
  /** Case IDs that appear more than once. */
  duplicateCaseIds: string[];
  /** Problems with `save` / `$ref` / `indistinguishableFrom` wiring inside cases. */
  referenceErrors: string[];
}

/** Walk steps, including those nested in `concurrent` steps. */
function* allSteps(steps: readonly Step[]): Generator<Step> {
  for (const step of steps) {
    yield step;
    const nested = step.input?.["steps"];
    if (step.op === "concurrent" && Array.isArray(nested)) {
      yield* allSteps(nested as Step[]);
    }
  }
}

function findRefs(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    const m = /^\$([A-Za-z][A-Za-z0-9_]*)/.exec(value);
    if (m) out.push(m[1]!);
  } else if (Array.isArray(value)) {
    value.forEach((v) => findRefs(v, out));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => findRefs(v, out));
  }
  return out;
}

/** `$config.*` refers to the effective configuration and is always available. */
export const RESERVED_REF = "config";

/** Check that every `$name` / `indistinguishableFrom` refers to an earlier `save`. */
export function checkCaseReferences(c: ConformanceCase): string[] {
  const errors: string[] = [];
  const saved = new Set<string>();
  const given = new Set([
    RESERVED_REF,
    ...c.given.flatMap((g) => ("user" in g ? [g.user] : [g.resource.id])),
  ]);
  for (const step of c.steps) {
    const nested = step.op === "concurrent" ? [...allSteps([step])] : [step];
    for (const s of nested) {
      for (const ref of [...findRefs(s.input), ...findRefs(s.expect?.assert)]) {
        if (!saved.has(ref) && !given.has(ref)) {
          errors.push(`${c.id}: '$${ref}' used before it is saved`);
        }
      }
      const ind = s.expect?.indistinguishableFrom;
      if (ind && !saved.has(ind)) {
        errors.push(`${c.id}: indistinguishableFrom '${ind}' refers to no earlier saved step`);
      }
    }
    for (const s of nested) {
      if (s.save) {
        if (saved.has(s.save)) errors.push(`${c.id}: '${s.save}' saved twice`);
        saved.add(s.save);
      }
    }
  }
  return errors;
}

export function computeCoverage(
  requirements: readonly Requirement[],
  cases: readonly ConformanceCase[],
  verification: readonly VerificationEntry[],
): CoverageReport {
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const caseRefs = new Map<string, string[]>();
  const verifRefs = new Map<string, VerificationEntry["methods"]>();
  const unknown = new Set<string>();
  const withdrawn = new Set<string>();

  const note = (id: string) => {
    const req = byId.get(id);
    if (!req) unknown.add(id);
    else if (req.withdrawn) withdrawn.add(id);
  };

  for (const c of cases) {
    for (const id of c.requirements) {
      note(id);
      caseRefs.set(id, [...(caseRefs.get(id) ?? []), c.id]);
    }
  }
  for (const v of verification) {
    note(v.requirement);
    verifRefs.set(v.requirement, [...(verifRefs.get(v.requirement) ?? []), ...v.methods]);
  }

  const seen = new Set<string>();
  const duplicateCaseIds = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) duplicateCaseIds.add(c.id);
    seen.add(c.id);
  }

  const coverage = requirements.map((requirement) => ({
    requirement,
    cases: caseRefs.get(requirement.id) ?? [],
    verification: verifRefs.get(requirement.id) ?? [],
  }));

  return {
    requirements: coverage,
    uncovered: coverage
      .filter(
        (c) => isMandatory(c.requirement) && c.cases.length === 0 && c.verification.length === 0,
      )
      .map((c) => c.requirement.id),
    unknownReferences: [...unknown].sort(),
    withdrawnReferences: [...withdrawn].sort(),
    duplicateCaseIds: [...duplicateCaseIds].sort(),
    referenceErrors: cases.flatMap(checkCaseReferences),
  };
}
