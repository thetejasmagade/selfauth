/* eslint-disable no-console */
import { createApp } from "./app.ts";
import { createAuth } from "./auth/index.ts";
import { createLogger } from "./auth/core/logger.ts";
import { localDevelopmentConfig } from "./config/dev-config.ts";
import { EnvError, loadEnv } from "./config/env.ts";
import { createMailer } from "./email/mailer.ts";
import { getRequestId } from "./http/request-id.ts";
import { mountRoutes } from "./routes/index.ts";
import { config as baseConfig } from "./config/selfauth.config.ts";
import { createStores } from "./db/store.ts";

try {
  const env = loadEnv();
  // Plain-http local development cannot use Secure / __Host- cookies.
  const config = env.nodeEnv === "production" ? baseConfig : localDevelopmentConfig(baseConfig);
  const mailer = createMailer(env);
  const { store, rateLimitStore } = await createStores(config);

  const auth = createAuth({
    config,
    store,
    mailer,
    appBaseUrl: env.appBaseUrl,
    nodeEnv: env.nodeEnv,
    requestId: getRequestId,
    ...(rateLimitStore ? { rateLimitStore } : {}),
    ...(env.csrfSecret ? { csrfSecret: env.csrfSecret } : {}),
    ...(env.csrfSecretPrevious ? { csrfSecretPrevious: env.csrfSecretPrevious } : {}),
  });
  const app = createApp({ env, config, auth, logger: createLogger(), mount: mountRoutes });
  app.listen(env.port, () => {
    console.log(`Listening on http://localhost:${env.port}`);
  });
} catch (error) {
  if (error instanceof EnvError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
