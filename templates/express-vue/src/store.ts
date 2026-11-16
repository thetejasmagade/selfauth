/* eslint-disable no-console */
import { MemoryAuthStore, syncRoles } from "./auth/index.ts";
import type { RateLimitStore } from "./auth/core/rate-limit.ts";
import type { AuthStore } from "./auth/core/store.ts";
import type { SelfAuthConfig } from "./auth/types.ts";
import { createPrismaClient, PrismaAuthStore, PrismaRateLimitStore } from "./auth/stores/prisma.ts";

export interface Stores {
  store: AuthStore;
  rateLimitStore?: RateLimitStore;
  close(): Promise<void>;
}

/**
 * PostgreSQL (Prisma) when DATABASE_URL is set, otherwise in-memory.
 * Never migrates or seeds on startup (DATA-MODEL-003, AUTHZ-RBAC-005):
 * run `npx selfauth db migrate` and `npm run db:seed` first.
 */
export async function createStores(config: SelfAuthConfig): Promise<Stores> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error(
        "DATABASE_URL is required in production; the in-memory store loses all data on restart.",
      );
    }
    const memory = new MemoryAuthStore();
    await syncRoles(memory, config); // memory does not persist, so it is seeded on start
    console.log("Using in-memory store (set DATABASE_URL to use PostgreSQL).");
    return { store: memory, close: async () => {} };
  }
  const db = createPrismaClient({ connectionString: databaseUrl });
  const store = new PrismaAuthStore(db);
  for (const role of config.authorization.defaultRoles) {
    if (!(await store.roleExists(role))) {
      throw new Error(
        `Role '${role}' is missing in the database. Run the migrations and \`npm run db:seed\` first.`,
      );
    }
  }
  console.log("Using PostgreSQL (Prisma) store.");
  return { store, rateLimitStore: new PrismaRateLimitStore(db), close: () => db.$disconnect() };
}
