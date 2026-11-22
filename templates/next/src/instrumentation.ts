/**
 * Runs once when the server starts. It builds SelfAuth right away so a bad environment variable
 * or an unreachable database stops the server with a clear message, the same as the other
 * SelfAuth backends, instead of failing on the first request.
 */
export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  // `next build` does not call this, so building needs no environment variables.
  const { getSelfAuth } = await import("./lib/auth.ts");
  await getSelfAuth();
}
