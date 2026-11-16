import { parseConfig, type SelfAuthConfig } from "@selfauth/spec";
import type express from "express";
import { createApp } from "../src/app.ts";
import {
  createAuth,
  ManualClock,
  MemoryAuthStore,
  MemoryMailer,
  syncRoles,
  type Auth,
} from "../src/auth/index.ts";
import { createLogger, MemoryLogSink } from "../src/auth/core/logger.ts";
import { loadEnv, type Env } from "../src/env.ts";
import { getRequestId } from "../src/request-id.ts";

export const TEST_BASE_URL = "https://app.example.test";
export const TEST_CSRF_SECRET = Buffer.alloc(32, 7);

export interface TestApp {
  app: express.Express;
  auth: Auth;
  config: SelfAuthConfig;
  env: Env;
  store: MemoryAuthStore;
  mailer: MemoryMailer;
  clock: ManualClock;
  logs: MemoryLogSink;
}

export async function buildTestApp(
  options: {
    config?: SelfAuthConfig;
    nodeEnv?: Env["nodeEnv"];
    mount?: (app: express.Express, auth: Auth) => void;
  } = {},
): Promise<TestApp> {
  const config =
    options.config ??
    parseConfig({ adapter: { backend: "express", database: "postgresql", orm: "prisma" } });
  const nodeEnv = options.nodeEnv ?? "test";
  const env: Env = {
    ...loadEnv({ NODE_ENV: nodeEnv, SELFAUTH_APP_BASE_URL: TEST_BASE_URL }),
    csrfSecret: TEST_CSRF_SECRET,
  };
  const store = new MemoryAuthStore();
  await syncRoles(store, config);
  const mailer = new MemoryMailer();
  const clock = new ManualClock();
  const logs = new MemoryLogSink();
  const auth = createAuth({
    config,
    store,
    mailer,
    clock,
    appBaseUrl: env.appBaseUrl,
    nodeEnv,
    requestId: getRequestId,
    csrfSecret: TEST_CSRF_SECRET,
  });
  const app = createApp({
    env,
    config,
    auth,
    logger: createLogger(logs),
    ...(options.mount ? { mount: options.mount } : {}),
  });
  return { app, auth, config, env, store, mailer, clock, logs };
}
