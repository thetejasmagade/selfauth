/**
 * Runs once when the server starts. It starts SelfAuth right away (src/lib/start.ts), so a bad
 * environment variable or an unreachable database stops the server with a clear message instead
 * of failing on the first request. `next build` does not call this, so building needs no
 * environment variables.
 */
export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const { startSelfAuth } = await import("./lib/start.ts");
    await startSelfAuth();
  }
}
