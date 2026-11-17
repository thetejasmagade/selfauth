/**
 * Specification types used by this application, kept locally so generated
 * code has no dependency on SelfAuth packages (ADR 0002). They mirror
 * `@selfauth/spec` (specVersion 0.1); the SelfAuth test suite checks they are
 * identical.
 */

/** Error codes (ERRORS.md). */
export type ErrorCode =
  | "VALIDATION_FAILED"
  | "PASSWORD_POLICY_VIOLATION"
  | "INVALID_CREDENTIALS"
  | "UNAUTHENTICATED"
  | "EMAIL_NOT_VERIFIED"
  | "ACCOUNT_UNAVAILABLE"
  | "FORBIDDEN"
  | "REAUTHENTICATION_REQUIRED"
  | "CSRF_FAILED"
  | "NOT_FOUND"
  | "TOKEN_INVALID"
  | "EMAIL_TAKEN"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_ERROR";

export interface ErrorDetail {
  field: string;
  issue: string;
}

/** Error envelope body (ERR-FORMAT-001). */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    details?: ErrorDetail[];
  };
}

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export interface RateLimitOperation {
  perAccount: RateLimitRule;
  perAddress: RateLimitRule;
}

/** Fully resolved configuration (CONFIGURATION_SPEC.md). */
export interface SelfAuthConfig {
  specVersion: string;
  adapter: {
    backend: "express" | "fastify";
    frontend: "vue" | "react" | "none";
    database: "postgresql" | "mongodb" | "memory";
    orm: "prisma" | "mongoose" | "none";
  };
  authentication: {
    methods: "password"[];
    emailVerification: { mode: "required" | "optional" | "off"; tokenTtlMinutes: number };
    registration: { revealExistingEmail: boolean; signInAfterRegistration: boolean };
    passwordReset: { tokenTtlMinutes: number };
    password: {
      minLength: number;
      maxLength: number;
      rejectCommon: boolean;
      hashing: { memoryKiB: number; iterations: number; parallelism: number };
    };
    sessions: {
      strategy: "database";
      idleTimeoutMinutes: number;
      absoluteTimeoutMinutes: number;
      touchIntervalSeconds: number;
      cookie: { name: string; sameSite: "lax" | "strict" | "none"; secure: boolean };
    };
    rateLimit: {
      login: RateLimitOperation;
      passwordChange: RateLimitOperation;
      register: RateLimitOperation;
      passwordResetRequest: RateLimitOperation;
      verificationResend: RateLimitOperation;
    };
  };
  authorization: {
    strategy: "rbac";
    permissions: string[];
    roles: Record<string, string[]>;
    defaultRoles: string[];
    reauthenticationWindowMinutes: number;
  };
  http: {
    bodyLimitBytes: number;
    basePath: string;
    trustedOrigins: string[];
    trustProxy: false | number | string[];
    csrf: { mode: "header" | "token"; headerName: string };
  };
}
