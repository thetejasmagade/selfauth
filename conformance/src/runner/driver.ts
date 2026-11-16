import type { SelfAuthConfig } from "@selfauth/spec";
import type { ConformanceCase } from "../schema.js";

/**
 * What an adapter provides so the runner can execute conformance cases.
 * HTTP requests follow the binding in AUTHENTICATION_SPEC §11; the harness
 * methods expose test-only views of time, mail, storage, events and logs.
 *
 * Drivers must also mount these harness routes (CONFORMANCE.md):
 *   POST /__conformance/permission/:permission      guarded by requirePermission
 *   POST /__conformance/resource/:permission/:type/:id  guarded by the resource policy
 *   POST /__conformance/unconfigured                protected route with no guard
 *   GET  /__conformance/list/:type                  owner-filtered list → { ids }
 *   GET  /__conformance/fault                       throws an unexpected error
 */
export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  /** JSON body, or a raw string body. */
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  /** Lower-case header names. `set-cookie` is always an array. */
  headers: Record<string, string | string[]>;
  body: unknown;
}

export interface CapturedEmail {
  kind: string;
  token?: string | undefined;
  link?: string | undefined;
}

export interface Driver {
  request(request: HttpRequest): Promise<HttpResponse>;
  /** IDs of `given` fixtures by name (users and resources). */
  fixtures: Record<string, { id: string }>;
  advanceClock(ms: number): Promise<void> | void;
  lastEmail(to: string): Promise<CapturedEmail | null>;
  /** Records of a DATA_MODEL entity: user (with `roles`), credential, session, passwordResetToken, emailVerificationToken. */
  inspectStorage(entity: string): Promise<Record<string, unknown>[]>;
  mutateStorage(
    entity: string,
    where: Record<string, unknown>,
    set: Record<string, unknown>,
  ): Promise<void>;
  events(): Promise<Record<string, unknown>[]>;
  logs(): Promise<string[]>;
  /** Whether the last list query filtered by owner in the query itself (AUTHZ-RES-006). */
  lastListQueryFiltered(): boolean | undefined;
  close?(): Promise<void>;
}

export interface DriverOptions {
  config: SelfAuthConfig;
  environment: "development" | "production";
  given: ConformanceCase["given"];
  /** The base URL email links must start with. */
  appBaseUrl: string;
}

export type DriverFactory = (options: DriverOptions) => Promise<Driver>;
