/* eslint-disable no-console */
/**
 * Backend for browser end-to-end tests (apps/e2e). Test-only: it serves the built Next.js app
 * (`next build` first) and puts a SelfAuth instance with an in-memory mailer where the route
 * handlers look for it, so email can be read at /__e2e/mail and tests can follow links. Same
 * contract as the other playgrounds' e2e servers, so one browser spec runs against all of them.
 * It lives in test/, never in src/, and refuses to run unless SELFAUTH_E2E=1.
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import next from "next";
import { createAuth, MemoryAuthStore, MemoryMailer, syncRoles } from "../src/auth/index.ts";
import { createLogger, MemoryLogSink } from "../src/auth/core/logger.ts";
import { localDevelopmentConfig } from "../src/config/dev-config.ts";
import { loadEnv } from "../src/config/env.ts";
import { config as baseConfig } from "../src/config/selfauth.config.ts";

if (process.env["SELFAUTH_E2E"] !== "1") throw new Error("e2e-server runs only with SELFAUTH_E2E=1");

const env = loadEnv({ ...process.env, NODE_ENV: "development" });
const config = localDevelopmentConfig(baseConfig);
const store = new MemoryAuthStore();
await syncRoles(store, config);
const mailer = new MemoryMailer();
const auth = createAuth({
  config,
  store,
  mailer,
  appBaseUrl: env.appBaseUrl,
  nodeEnv: "development",
  logger: createLogger(new MemoryLogSink()),
});
// The route handlers use whatever instance is registered here (src/lib/auth.ts).
(globalThis as Record<symbol, unknown>)[Symbol.for("selfauth.instance")] = Promise.resolve({
  auth,
  db: undefined,
});

const app = next({ dev: false, dir: fileURLToPath(new URL("..", import.meta.url)) });
await app.prepare();
const handle = app.getRequestHandler();

const readBody = async (req: import("node:http").IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  void (async () => {
    if (url.pathname === "/__e2e/mail") {
      const mail = mailer.lastTo(url.searchParams.get("to") ?? "");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(mail ? { kind: mail.kind, link: mail.link ?? null } : null));
    } else if (url.pathname === "/__e2e/grant" && req.method === "POST") {
      // Grants a role directly, standing in for `db:create-admin` in tests.
      const body = JSON.parse((await readBody(req)) || "{}") as { email?: unknown; role?: unknown };
      const user = await store.findUserByEmail(String(body.email ?? "").toLowerCase());
      if (!user) res.statusCode = 404;
      else {
        await store.addUserRole(user.id, String(body.role), null, new Date());
        res.statusCode = 204;
      }
      res.end();
    } else {
      await handle(req, res);
    }
  })().catch((error: unknown) => {
    console.error(error);
    res.statusCode = 500;
    res.end();
  });
}).listen(env.port, "0.0.0.0", () => console.log(`e2e backend on :${env.port}`));
