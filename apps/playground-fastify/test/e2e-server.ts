/* eslint-disable no-console */
/**
 * Backend for browser end-to-end tests (apps/e2e). Test-only: it captures email in memory and
 * exposes the last message per address at /__e2e/mail so tests can follow links. It refuses to
 * run outside NODE_ENV=test and lives in test/, never in src/. Same contract as the Express
 * playground's e2e server, so one browser spec runs against both backends.
 */
import { createApp } from "../src/app.ts";
import { createAuth, MemoryAuthStore, MemoryMailer, syncRoles } from "../src/auth/index.ts";
import { createLogger, MemoryLogSink } from "../src/auth/core/logger.ts";
import { loadEnv } from "../src/config/env.ts";
import { mountNotes } from "../src/routes/notes.ts";
import { getRequestId } from "../src/http/request-id.ts";
import { localDevelopmentConfig } from "../src/config/dev-config.ts";
import { config as baseConfig } from "../src/config/selfauth.config.ts";

if (process.env["NODE_ENV"] !== "test") throw new Error("e2e-server runs only with NODE_ENV=test");

const env = loadEnv();
const config = localDevelopmentConfig(baseConfig);
const store = new MemoryAuthStore();
await syncRoles(store, config);
const mailer = new MemoryMailer();
const auth = createAuth({
  config,
  store,
  mailer,
  appBaseUrl: env.appBaseUrl,
  nodeEnv: env.nodeEnv,
  requestId: getRequestId,
});

const app = createApp({
  env,
  config,
  auth,
  logger: createLogger(new MemoryLogSink()),
  mount: (a, au) => {
    mountNotes(a, au);
    a.get("/__e2e/mail", async (req) => {
      const to = String((req.query as { to?: unknown }).to ?? "");
      const mail = mailer.lastTo(to);
      return mail ? { kind: mail.kind, link: mail.link ?? null } : null;
    });
    // Grants a role directly, standing in for `db:create-admin` in tests.
    a.post("/__e2e/grant", async (req, reply) => {
      const body = (req.body ?? {}) as { email?: unknown; role?: unknown };
      const user = await store.findUserByEmail(String(body.email ?? "").toLowerCase());
      if (!user) return reply.code(404).send();
      await store.addUserRole(user.id, String(body.role), null, new Date());
      return reply.code(204).send();
    });
  },
});
await app.listen({ port: env.port, host: "0.0.0.0" });
console.log(`e2e backend on :${env.port}`);
