/* eslint-disable no-console */
/**
 * Backend for browser end-to-end tests (apps/playground-vue/e2e). Test-only:
 * it captures email in memory and exposes the last message per address at
 * /__e2e/mail so tests can follow links. It refuses to run outside
 * NODE_ENV=test and lives in test/, never in src/.
 */
import express from "express";
import { createApp } from "../src/app.ts";
import { createAuth, MemoryAuthStore, MemoryMailer, syncRoles } from "../src/auth/index.ts";
import { createLogger, MemoryLogSink } from "../src/auth/core/logger.ts";
import { loadEnv } from "../src/env.ts";
import { mountNotes } from "../src/example/notes.ts";
import { getRequestId } from "../src/request-id.ts";
import { config as baseConfig, localDevelopmentConfig } from "../src/selfauth.config.ts";

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
    a.get("/__e2e/mail", (req, res) => {
      const mail = mailer.lastTo(String(req.query["to"] ?? ""));
      res.json(mail ? { kind: mail.kind, link: mail.link ?? null } : null);
    });
    // Grants a role directly, standing in for `db:create-admin` in tests.
    a.post("/__e2e/grant", express.json(), async (req, res) => {
      const user = await store.findUserByEmail(String(req.body?.email ?? "").toLowerCase());
      if (!user) return void res.status(404).end();
      await store.addUserRole(user.id, String(req.body.role), null, new Date());
      res.status(204).end();
    });
  },
});
app.listen(env.port, () => console.log(`e2e backend on :${env.port}`));
