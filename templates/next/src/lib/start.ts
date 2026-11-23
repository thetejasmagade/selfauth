import { getSelfAuth } from "./auth.ts";

/**
 * Builds SelfAuth when the server boots, so a bad environment variable or an unreachable database
 * stops the server with a clear message, the same as the other SelfAuth backends, instead of
 * failing on the first request. Called from src/instrumentation.ts, on the Node.js runtime only.
 */
export async function startSelfAuth(): Promise<void> {
  try {
    await getSelfAuth();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `SelfAuth could not start: ${error instanceof Error ? error.message : String(error)}`,
    );
    // Next.js would keep serving (and answer health checks) without authentication, so a
    // production server stops. In development the error is shown and the fix is picked up.
    if (process.env["NODE_ENV"] === "production") process.exit(1);
    throw error;
  }
}
