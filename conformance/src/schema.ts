import { ERROR_CODES, REQUIREMENT_ID_PATTERN } from "@selfauth/spec";
import { z } from "zod";

const requirementId = z.string().regex(new RegExp(`^${REQUIREMENT_ID_PATTERN.source}$`));

/** Operations a conformance driver must implement (specs/CONFORMANCE.md). */
export const OPERATIONS = [
  // Authentication
  "register",
  "login",
  "logout",
  "logoutAll",
  "getCurrentUser",
  "listSessions",
  "revokeSession",
  "requestEmailVerification",
  "verifyEmail",
  "changePassword",
  "requestPasswordReset",
  "resetPassword",
  "deleteAccount",
  // Authorization
  "callProtected",
  "listOwned",
  // Administration
  "assignRole",
  "removeRole",
  "setAccountState",
  // Harness
  "advanceClock",
  "readLastEmail",
  "concurrent",
  "inspectStorage",
  "mutateStorage",
  "inspectEvents",
  "inspectLogs",
  "rawRequest",
] as const;
export type Operation = (typeof OPERATIONS)[number];

export const LEVELS = ["core", "authorization", "production"] as const;

export const ACCOUNT_STATES = ["pending", "active", "suspended", "disabled", "deleted"] as const;

const errorCode = z.enum(ERROR_CODES);

export const expectationSchema = z
  .strictObject({
    outcome: z.enum(["success", "error"]),
    code: errorCode.optional(),
    codeOneOf: z.array(errorCode).min(2).optional(),
    indistinguishableFrom: z.string().optional(),
    sessionCreated: z.boolean().optional(),
    successCount: z.number().int().min(0).optional(),
    assert: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((e, ctx) => {
    const hasCode = e.code !== undefined || e.codeOneOf !== undefined;
    if (e.outcome === "error" && !hasCode) {
      ctx.addIssue({ code: "custom", message: "error expectations need code or codeOneOf" });
    }
    if (e.outcome === "success" && hasCode) {
      ctx.addIssue({ code: "custom", message: "success expectations must not name an error code" });
    }
    if (e.code !== undefined && e.codeOneOf !== undefined) {
      ctx.addIssue({ code: "custom", message: "use code or codeOneOf, not both" });
    }
  });
export type Expectation = z.infer<typeof expectationSchema>;

export interface Step {
  op: Operation;
  as?: string | undefined;
  note?: string | undefined;
  input?: Record<string, unknown> | undefined;
  expect?: Expectation | undefined;
  save?: string | undefined;
}

export const stepSchema: z.ZodType<Step> = z.lazy(() =>
  z.strictObject({
    op: z.enum(OPERATIONS),
    as: z.string().min(1).optional(),
    note: z.string().optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    expect: expectationSchema.optional(),
    save: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
      .optional(),
  }),
);

const userFixture = z.strictObject({
  user: z.string().min(1),
  email: z.string().min(3),
  password: z.string().min(1),
  state: z.enum(ACCOUNT_STATES).default("active"),
  roles: z.array(z.string()).optional(),
});

const resourceFixture = z.strictObject({
  resource: z.strictObject({
    type: z.string().min(1),
    id: z.string().min(1),
    owner: z.string().min(1),
  }),
});

export const caseSchema = z.strictObject({
  id: z.string().regex(/^CT-[A-Z]+-\d{3}$/),
  title: z.string().min(1),
  category: z.string().min(1),
  level: z.enum(LEVELS),
  requirements: z.array(requirementId).min(1),
  /** Runtime environment the driver must simulate (default: development). */
  environment: z.enum(["development", "production"]).optional(),
  /** Partial SelfAuth configuration merged over the driver's base configuration. */
  config: z.record(z.string(), z.unknown()).optional(),
  given: z.array(z.union([userFixture, resourceFixture])).default([]),
  steps: z.array(stepSchema).min(1),
});
export type ConformanceCase = z.infer<typeof caseSchema>;

export const caseFileSchema = z.strictObject({
  $schema: z.string().optional(),
  cases: z.array(caseSchema).min(1),
});

export const VERIFICATION_METHODS = [
  "schema-test",
  "adapter-test",
  "code-review",
  "documentation",
  "static-analysis",
  "migration-test",
] as const;

export const verificationEntrySchema = z.strictObject({
  requirement: requirementId,
  methods: z.array(z.enum(VERIFICATION_METHODS)).min(1),
  how: z.string().min(10),
});
export type VerificationEntry = z.infer<typeof verificationEntrySchema>;

export const verificationFileSchema = z.strictObject({
  $comment: z.string().optional(),
  entries: z.array(verificationEntrySchema),
});
