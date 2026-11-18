import { parseConfig, type SelfAuthConfig } from "@selfauth/spec";
import type { FastifyInstance } from "fastify";
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
import type { PrismaAuthStore } from "../src/auth/stores/prisma.ts";
import { createTestDatabase, type TestDatabase } from "./database.ts";
import type { TestSchema } from "./postgres.ts";
import { loadEnv, type Env } from "../src/config/env.ts";
import { getRequestId } from "../src/http/request-id.ts";

export const TEST_BASE_URL = "https://app.example.test";
export const TEST_CSRF_SECRET = Buffer.alloc(32, 7);

export type StoreKind = "memory" | "postgres";

export interface TestApp {
  app: FastifyInstance;
  auth: Auth;
  config: SelfAuthConfig;
  env: Env;
  store: AuthStore;
  /** Set for the memory store. */
  memory?: MemoryAuthStore;
  /** Set for the postgres store. */
  prisma?: PrismaAuthStore;
  schema?: TestSchema;
  /** Set for a database-backed store: what the conformance driver reads and changes. */
  database?: TestDatabase;
  mailer: MemoryMailer;
  clock: ManualClock;
  logs: MemoryLogSink;
  close(): Promise<void>;
}

export async function buildTestApp(
  options: {
    config?: SelfAuthConfig;
    nodeEnv?: Env["nodeEnv"];
    mount?: (app: FastifyInstance, auth: Auth) => void;
    store?: StoreKind;
  } = {},
): Promise<TestApp> {
  const config =
    options.config ??
    parseConfig({ adapter: { backend: "fastify", database: "postgresql", orm: "prisma" } });
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
  let database: TestDatabase | undefined;
  if (options.store === "postgres") {
    database = await createTestDatabase();
    store = database.store;
    rateLimitStore = database.rateLimitStore;
    prisma = database.prisma;
    schema = database.schema;
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
    await database?.close();
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
    ...(database ? { database } : {}),
    mailer,
    clock,
    logs,
    close,
  };
}
