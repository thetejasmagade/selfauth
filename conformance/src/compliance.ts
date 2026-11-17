import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isMandatory, type Requirement } from "@selfauth/spec";
import { z } from "zod";
import { runCase } from "./runner/run.js";
import type { DriverFactory } from "./runner/driver.js";
import {
  VERIFICATION_METHODS,
  type ConformanceCase,
  type VerificationEntry,
  LEVELS,
} from "./schema.js";

/** Compliance levels, lowest first (specs/CONFORMANCE.md, "Compliance levels"). */
export type Level = (typeof LEVELS)[number];
export const LEVEL_TITLES: Record<Level, string> = {
  core: "Core compliant",
  authorization: "Authorization compliant",
  production: "Production-profile compliant",
};

/**
 * The behaviour areas the plan names (Phase 9). Every requirement belongs to exactly one,
 * by ID prefix, so each area reports how many of its mandatory requirements are covered.
 */
export interface Category {
  id: string;
  title: string;
  prefixes: string[];
}
export const CATEGORIES: readonly Category[] = [
  {
    id: "registration",
    title: "Registration and identity",
    prefixes: [
      "AUTHN-REG",
      "IDENT-ID",
      "IDENT-EMAIL",
      "IDENT-STATE",
      "IDENT-PROFILE",
      "IDENT-DELETE",
    ],
  },
  { id: "login", title: "Login and logout", prefixes: ["AUTHN-LOGIN", "AUTHN-LOGOUT", "AUTHN-ME"] },
  { id: "passwords", title: "Password storage", prefixes: ["SEC-HASH", "SEC-PWPOLICY"] },
  {
    id: "sessions",
    title: "Session expiration and revocation",
    prefixes: ["AUTHN-SESS", "SEC-COOKIE"],
  },
  {
    id: "recovery",
    title: "Password recovery and change",
    prefixes: ["AUTHN-RESET", "AUTHN-PWCHG", "SEC-TOKEN"],
  },
  { id: "verification", title: "Email verification", prefixes: ["AUTHN-VERIFY"] },
  { id: "rbac", title: "RBAC", prefixes: ["AUTHZ-RBAC", "AUTHZ-PERM", "AUTHZ-ADMIN"] },
  {
    id: "enforcement",
    title: "Permission enforcement",
    prefixes: ["AUTHZ-CORE", "AUTHZ-AUDIT"],
  },
  { id: "ownership", title: "Resource ownership", prefixes: ["AUTHZ-RES"] },
  {
    id: "browser",
    title: "CSRF and browser safety",
    prefixes: ["SEC-CSRF", "SEC-CORS", "SEC-REDIRECT", "SEC-HTTP"],
  },
  { id: "rate-limits", title: "Rate limiting", prefixes: ["SEC-RATE"] },
  {
    id: "redaction",
    title: "Secret and log redaction",
    prefixes: ["SEC-SECRET", "SEC-LOG", "SEC-AUDIT"],
  },
  { id: "errors", title: "Errors and enumeration safety", prefixes: ["ERR-FORMAT", "SEC-ENUM"] },
  { id: "migrations", title: "Migration safety", prefixes: ["DATA-MODEL"] },
  { id: "config", title: "Configuration", prefixes: ["CONF-FILE"] },
];

export const requirementPrefix = (id: string): string => id.replace(/-\d{3}$/, "");
export const categoryOf = (id: string): Category | undefined =>
  CATEGORIES.find((c) => c.prefixes.includes(requirementPrefix(id)));

export interface CaseResult {
  id: string;
  title: string;
  category: string;
  level: Level;
  passed: boolean;
  error?: string;
}

/** Runs every case against a driver. Never throws: a failing case is a result. */
export async function runSuite(
  cases: readonly ConformanceCase[],
  createDriver: DriverFactory,
): Promise<CaseResult[]> {
  return Promise.all(
    cases.map(async (c): Promise<CaseResult> => {
      const base = { id: c.id, title: c.title, category: c.category, level: c.level };
      try {
        await runCase(c, createDriver);
        return { ...base, passed: true };
      } catch (error) {
        return { ...base, passed: false, error: (error as Error).message };
      }
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Adapter record: what an adapter claims and the evidence behind every non-case requirement.
// ---------------------------------------------------------------------------------------------

export const signoffSchema = z.strictObject({
  requirement: z.string(),
  method: z.enum(VERIFICATION_METHODS),
  /** Repository paths (tests, source, docs, workflows) that carry out or document the check. */
  evidence: z.array(z.string().min(1)).min(1),
  /** What was checked. Required: a sign-off without a finding is not a review. */
  finding: z.string().min(20),
});
export type Signoff = z.infer<typeof signoffSchema>;

export const adapterRecordSchema = z.strictObject({
  $comment: z.string().optional(),
  adapter: z.string(),
  title: z.string(),
  specVersion: z.string(),
  /** Level each store must reach in CI; the test fails if a run measures anything else. */
  claims: z.record(z.string(), z.enum(LEVELS)),
  supports: z.array(
    z.strictObject({
      kind: z.enum(["backend", "database", "frontend"]),
      id: z.string(),
      title: z.string(),
      store: z.string().optional(),
    }),
  ),
  /** True only when someone outside the project has audited the code. */
  independentAudit: z.boolean(),
  limitations: z.array(z.string()),
  signoffs: z.array(signoffSchema),
});
export type AdapterRecord = z.infer<typeof adapterRecordSchema>;

export async function loadAdapterRecord(file: string): Promise<AdapterRecord> {
  return adapterRecordSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

/** Methods an automated test carries out; the rest need a person to review. */
const AUTOMATED = new Set(["adapter-test", "schema-test", "migration-test"]);

/** `AUTHZ-*` items gate the authorization level; everything else gates core. */
const itemLevel = (requirement: string): Level =>
  requirement.startsWith("AUTHZ-") ? "authorization" : "core";

export interface LevelStatus {
  met: boolean;
  /** What is still missing, in the order to fix it. */
  missing: string[];
}
export interface LevelReport {
  levels: Record<Level, LevelStatus>;
  /** Highest level met, or `none`. */
  achieved: Level | "none";
}

/**
 * A level is met when its cases pass and its verification items have a recorded sign-off.
 * Higher levels include everything below: core, then authorization, then production (all cases
 * plus every item, including reviews, documentation and static analysis).
 */
export function evaluateLevels(input: {
  cases: readonly ConformanceCase[];
  results: readonly CaseResult[];
  verification: readonly VerificationEntry[];
  signoffs: readonly Signoff[];
}): LevelReport {
  const result = new Map(input.results.map((r) => [r.id, r]));
  const signed = new Set(input.signoffs.map((s) => `${s.requirement}:${s.method}`));

  const caseProblems = (level: Level): string[] =>
    input.cases
      .filter((c) => c.level === level)
      .flatMap((c) => {
        const r = result.get(c.id);
        return r?.passed
          ? []
          : [r ? `case ${c.id} fails: ${r.error ?? ""}` : `case ${c.id} not run`];
      });

  const itemProblems = (include: (v: VerificationEntry, method: string) => boolean): string[] =>
    input.verification.flatMap((v) =>
      v.methods
        .filter((m) => include(v, m) && !signed.has(`${v.requirement}:${m}`))
        .map((m) => `${v.requirement} ${m}: no sign-off`),
    );

  const core = [
    ...caseProblems("core"),
    ...itemProblems((v, m) => AUTOMATED.has(m) && itemLevel(v.requirement) === "core"),
  ];
  const authorization = [
    ...core,
    ...caseProblems("authorization"),
    ...itemProblems((v, m) => AUTOMATED.has(m) && itemLevel(v.requirement) === "authorization"),
  ];
  const production = [
    ...authorization,
    ...caseProblems("production"),
    ...itemProblems((_v, m) => !AUTOMATED.has(m)),
  ];

  const levels: Record<Level, LevelStatus> = {
    core: { met: core.length === 0, missing: core },
    authorization: { met: authorization.length === 0, missing: authorization },
    production: { met: production.length === 0, missing: production },
  };
  const achieved = LEVELS.filter((l) => levels[l].met).at(-1) ?? "none";
  return { levels, achieved };
}

/** Problems with the sign-offs themselves; empty when the record is trustworthy. */
export function checkSignoffs(
  record: AdapterRecord,
  verification: readonly VerificationEntry[],
  repositoryRoot: string,
): string[] {
  const problems: string[] = [];
  const required = new Set(
    verification.flatMap((v) => v.methods.map((m) => `${v.requirement}:${m}`)),
  );
  const seen = new Set<string>();
  for (const s of record.signoffs) {
    const key = `${s.requirement}:${s.method}`;
    if (!required.has(key)) problems.push(`${key}: not a verification item`);
    if (seen.has(key)) problems.push(`${key}: signed off twice`);
    seen.add(key);
    for (const path of s.evidence) {
      if (!existsSync(join(repositoryRoot, path)))
        problems.push(`${key}: evidence '${path}' not found`);
    }
  }
  for (const key of required) if (!seen.has(key)) problems.push(`${key}: no sign-off`);
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------

export interface CategoryCoverage {
  category: Category;
  mandatory: number;
  byCases: number;
  byOtherVerification: number;
  cases: number;
}

export function categoryCoverage(
  requirements: readonly Requirement[],
  cases: readonly ConformanceCase[],
  verification: readonly VerificationEntry[],
): CategoryCoverage[] {
  const verified = new Set(verification.map((v) => v.requirement));
  return CATEGORIES.map((category) => {
    const mandatory = requirements.filter(
      (r) => isMandatory(r) && categoryOf(r.id)?.id === category.id,
    );
    const cased = (id: string) => cases.some((c) => c.requirements.includes(id));
    return {
      category,
      mandatory: mandatory.length,
      byCases: mandatory.filter((r) => cased(r.id)).length,
      byOtherVerification: mandatory.filter((r) => !cased(r.id) && verified.has(r.id)).length,
      cases: cases.filter((c) => c.requirements.some((id) => categoryOf(id)?.id === category.id))
        .length,
    };
  });
}
