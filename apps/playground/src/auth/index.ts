/**
 * SelfAuth reference implementation for Express (Phase 3).
 *
 * This directory is application-owned code: it is what the SelfAuth generator
 * will write into a project. It has no runtime dependency on SelfAuth packages
 * (only `import type` from @selfauth/spec).
 */
import type { SelfAuthConfig } from "./types.ts";
import type { Response } from "express";
import { PolicyRegistry, roleDefinitions } from "./core/authorization.ts";
import { systemClock, type Clock } from "./core/clock.ts";
import type { Mailer } from "./core/mailer.ts";
import { PasswordHasher } from "./core/password.ts";
import { MemoryRateLimitStore, RateLimiter, type RateLimitStore } from "./core/rate-limit.ts";
import { AuthService } from "./core/service.ts";
import type { AuthStore } from "./core/store.ts";
import { createExpressAuth, type ExpressAuth } from "./express/index.ts";

export interface CreateAuthOptions {
  config: SelfAuthConfig;
  store: AuthStore;
  mailer: Mailer;
  appBaseUrl: URL;
  nodeEnv: "development" | "test" | "production";
  requestId: (res: Response) => string;
  clock?: Clock;
  rateLimitStore?: RateLimitStore;
  csrfSecret?: Buffer;
  csrfSecretPrevious?: Buffer;
}

export interface Auth extends ExpressAuth {
  service: AuthService;
  policies: PolicyRegistry;
  hasher: PasswordHasher;
}

/** Stores this adapter implements; the configuration schema also allows others (e.g. MongoDB). */
const SUPPORTED_DATABASES: readonly string[] = ["postgresql", "mysql", "sqlite", "memory"];

export function createAuth(options: CreateAuthOptions): Auth {
  const { config, nodeEnv } = options;
  // CONF-FILE-004: the schema describes every adapter; this one implements only some of it.
  if (!SUPPORTED_DATABASES.includes(config.adapter.database)) {
    throw new Error(
      `The Express adapter does not support database '${config.adapter.database}' ` +
        `(supported: ${SUPPORTED_DATABASES.join(", ")}; CONF-FILE-004)`,
    );
  }
  // SEC-COOKIE-003: insecure cookies only outside production.
  if (nodeEnv === "production" && !config.authentication.sessions.cookie.secure) {
    throw new Error("authentication.sessions.cookie.secure must be true in production");
  }
  if (nodeEnv === "production" && options.appBaseUrl.protocol !== "https:") {
    throw new Error("The application base URL must use https in production (SEC-HTTP-002)");
  }
  const clock = options.clock ?? systemClock;
  const hasher = new PasswordHasher(config.authentication.password.hashing);
  const limiter = new RateLimiter(options.rateLimitStore ?? new MemoryRateLimitStore(), clock);
  const service = new AuthService({
    config,
    store: options.store,
    mailer: options.mailer,
    clock,
    hasher,
    limiter,
    appBaseUrl: options.appBaseUrl,
  });
  const policies = new PolicyRegistry();
  const express = createExpressAuth({
    config,
    service,
    policies,
    appBaseUrl: options.appBaseUrl,
    clock,
    csrfSecret: options.csrfSecret,
    csrfSecretPrevious: options.csrfSecretPrevious,
    requestId: options.requestId,
  });
  return { ...express, service, policies, hasher };
}

/**
 * Writes configured roles and permissions to storage (AUTHZ-RBAC-005). Run it
 * as an explicit seed/migration step; with the in-memory store the playground
 * runs it at startup because memory does not persist.
 */
export async function syncRoles(store: AuthStore, config: SelfAuthConfig): Promise<void> {
  await store.syncRoles(roleDefinitions(config));
}

export { ownershipPolicy, ownerFilter, type Resource, type Subject } from "./core/authorization.ts";
export { ManualClock, systemClock, type Clock } from "./core/clock.ts";
export { DevConsoleMailer, MemoryMailer, type Mailer } from "./core/mailer.ts";
export { MemoryAuthStore } from "./stores/memory.ts";
