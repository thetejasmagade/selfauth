/* eslint-disable no-console */
import { createApp } from "./app.ts";
import { EnvError, loadEnv } from "./env.ts";

try {
  const env = loadEnv();
  createApp(env).listen(env.port, () => {
    console.log(`SelfAuth playground listening on http://localhost:${env.port}`);
  });
} catch (error) {
  if (error instanceof EnvError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
