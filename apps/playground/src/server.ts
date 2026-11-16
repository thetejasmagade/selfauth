/* eslint-disable no-console */
import { createApp } from "./app.ts";
import { createAuth, DevConsoleMailer, MemoryAuthStore, syncRoles } from "./auth/index.ts";
import { createLogger } from "./auth/core/logger.ts";
import { EnvError, loadEnv } from "./env.ts";
import { mountNotes } from "./example/notes.ts";
import { getRequestId } from "./request-id.ts";
import { config as baseConfig, localDevelopmentConfig } from "./selfauth.config.ts";

try {
  const env = loadEnv();
  const config = env.nodeEnv === "production" ? baseConfig : localDevelopmentConfig(baseConfig);
  if (env.nodeEnv === "production") {
    throw new Error(
      "The playground uses an in-memory store and dev mailer; it is not a production server.",
    );
  }
  const store = new MemoryAuthStore();
  await syncRoles(store, config); // explicit seed step (AUTHZ-RBAC-005); memory does not persist
  const auth = createAuth({
    config,
    store,
    mailer: new DevConsoleMailer(env.nodeEnv),
    appBaseUrl: env.appBaseUrl,
    nodeEnv: env.nodeEnv,
    requestId: getRequestId,
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
