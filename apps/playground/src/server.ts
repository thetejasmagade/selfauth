/* eslint-disable no-console */
import { createApp } from "./app.ts";
import { createAuth, DevConsoleMailer, MemoryAuthStore, syncRoles } from "./auth/index.ts";
import { createLogger } from "./auth/core/logger.ts";
import type { RateLimitStore } from "./auth/core/rate-limit.ts";
import type { AuthStore } from "./auth/core/store.ts";
import { createPrismaClient, PrismaAuthStore, PrismaRateLimitStore } from "./auth/stores/prisma.ts";
import { EnvError, loadEnv } from "./env.ts";
import { mountNotes } from "./example/notes.ts";
import { getRequestId } from "./request-id.ts";
import { config as baseConfig, localDevelopmentConfig } from "./selfauth.config.ts";

try {
  const env = loadEnv();
  if (env.nodeEnv === "production") {
    throw new Error("The playground uses a development mailer; it is not a production server.");
  }
  const config = localDevelopmentConfig(baseConfig);

  let store: AuthStore;
  let rateLimitStore: RateLimitStore | undefined;
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl) {
    // Never migrates or seeds on startup (DATA-MODEL-003, AUTHZ-RBAC-005): run `pnpm db:migrate` and `pnpm db:seed`.
    const db = createPrismaClient({ connectionString: databaseUrl });
    const prisma = new PrismaAuthStore(db);
    for (const role of config.authorization.defaultRoles) {
      if (!(await prisma.roleExists(role))) {
        throw new Error(
          `Role '${role}' is missing in the database. Run \`pnpm db:migrate\` and \`pnpm db:seed\` first.`,
        );
      }
    }
    store = prisma;
    rateLimitStore = new PrismaRateLimitStore(db);
    console.log("Using PostgreSQL (Prisma) store.");
  } else {
    const memory = new MemoryAuthStore();
    await syncRoles(memory, config); // memory does not persist, so it is seeded on start
    store = memory;
    console.log("Using in-memory store (set DATABASE_URL to use PostgreSQL).");
  }

  const auth = createAuth({
    config,
    store,
    mailer: new DevConsoleMailer(env.nodeEnv),
    appBaseUrl: env.appBaseUrl,
    nodeEnv: env.nodeEnv,
    requestId: getRequestId,
    ...(rateLimitStore ? { rateLimitStore } : {}),
    ...(env.csrfSecret ? { csrfSecret: env.csrfSecret } : {}),
    ...(env.csrfSecretPrevious ? { csrfSecretPrevious: env.csrfSecretPrevious } : {}),
  });
  const app = createApp({ env, config, auth, logger: createLogger(), mount: mountNotes });
  app.listen(env.port, () => {
    console.log(`SelfAuth playground listening on http://localhost:${env.port}`);
  });
} catch (error) {
  if (error instanceof EnvError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
