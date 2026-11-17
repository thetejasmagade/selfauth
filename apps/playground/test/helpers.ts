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
import type { RateLimitStore } from "../src/auth/core/rate-limit.ts";
import type { AuthStore } from "../src/auth/core/store.ts";
import {
  createPrismaClient,
  PrismaAuthStore,
  PrismaRateLimitStore,
} from "../src/auth/stores/prisma.ts";
import { createTestSchema, TEST_DATABASE_URL, type TestSchema } from "./postgres.ts";
import { loadEnv, type Env } from "../src/config/env.ts";
import { getRequestId } from "../src/http/request-id.ts";

export const TEST_BASE_URL = "https://app.example.test";
export const TEST_CSRF_SECRET = Buffer.alloc(32, 7);

export type StoreKind = "memory" | "postgres";

export interface TestApp {
  app: express.Express;
  auth: Auth;
  config: SelfAuthConfig;
  env: Env;
  store: AuthStore;
  /** Set for the memory store. */
  memory?: MemoryAuthStore;
  /** Set for the postgres store. */
  prisma?: PrismaAuthStore;
  schema?: TestSchema;
  mailer: MemoryMailer;
  clock: ManualClock;
  logs: MemoryLogSink;
  close(): Promise<void>;
}

export async function buildTestApp(
  options: {
    config?: SelfAuthConfig;
    nodeEnv?: Env["nodeEnv"];
    mount?: (app: express.Express, auth: Auth) => void;
    store?: StoreKind;
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
  let store: AuthStore;
  let rateLimitStore: RateLimitStore | undefined;
  let memory: MemoryAuthStore | undefined;
  let prisma: PrismaAuthStore | undefined;
  let schema: TestSchema | undefined;
  if (options.store === "postgres") {
    schema = await createTestSchema();
    const db = createPrismaClient({
      connectionString: TEST_DATABASE_URL!,
      schema: schema.schema,
      max: 4,
    });
    store = prisma = new PrismaAuthStore(db);
    rateLimitStore = new PrismaRateLimitStore(db);
  } else {
    store = memory = new MemoryAuthStore();
  }
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
    ...(rateLimitStore ? { rateLimitStore } : {}),
  });
  const app = createApp({
    env,
    config,
    auth,
    logger: createLogger(logs),
    ...(options.mount ? { mount: options.mount } : {}),
  });
  const close = async () => {
    await prisma?.db.$disconnect();
    await schema?.drop();
  };
  return {
    app,
    auth,
    config,
    env,
    store,
    ...(memory ? { memory } : {}),
    ...(prisma ? { prisma } : {}),
    ...(schema ? { schema } : {}),
    mailer,
    clock,
    logs,
    close,
  };
}
