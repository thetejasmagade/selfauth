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
  const { store, rateLimitStore, db } = await createStores(config);

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
  const app = createApp({
    env,
    config,
    auth,
    logger: createLogger(),
    mount: (app, auth) => mountRoutes(app, auth, db),
  });
  // Like Express, listen on every IPv4 interface. Set HOST to narrow it (127.0.0.1) or to use
  // IPv6 ("::"); Fastify itself defaults to localhost only, which is unreachable from a container.
  try {
    await app.listen({ port: env.port, host: process.env["HOST"] ?? "0.0.0.0" });
  } catch (error) {
    // A failed start (the port is taken, for example) gets one clear line, not a stack trace.
    console.error(`Could not start on port ${env.port}: ${(error as Error).message}`);
    process.exit(1);
  }
  console.log(`Listening on http://localhost:${env.port}`);
} catch (error) {
  if (error instanceof EnvError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
