/* eslint-disable no-console */
import { MemoryAuthStore, syncRoles } from "./auth/index.ts";
import type { RateLimitStore } from "./auth/core/rate-limit.ts";
import type { AuthStore } from "./auth/core/store.ts";
import type { SelfAuthConfig } from "./auth/types.ts";

export interface Stores {
  store: AuthStore;
  rateLimitStore?: RateLimitStore;
  close(): Promise<void>;
}

/**
 * In-memory store: for trying SelfAuth out and for tests. Data is lost on
 * restart and is not shared between processes. Regenerate with
 * `--database postgresql` (or add a database store) before production.
 */
export async function createStores(config: SelfAuthConfig): Promise<Stores> {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("The in-memory store is not for production: it loses all data on restart.");
  }
  const memory = new MemoryAuthStore();
  await syncRoles(memory, config);
  console.log("Using in-memory store.");
  return { store: memory, close: async () => {} };
}
