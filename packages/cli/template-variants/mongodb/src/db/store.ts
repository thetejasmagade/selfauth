/* eslint-disable no-console */
import { MemoryAuthStore, syncRoles } from "../auth/index.ts";
import type { RateLimitStore } from "../auth/core/rate-limit.ts";
import type { AuthStore } from "../auth/core/store.ts";
import type { SelfAuthConfig } from "../auth/types.ts";
import {
  createMongooseConnection,
  missingIndexes,
  MongooseAuthStore,
  MongooseRateLimitStore,
} from "../auth/stores/mongoose.ts";
import type { Connection } from "mongoose";

/**
 * Your application's own access to the database, for your own collections: the same Mongoose
 * connection SelfAuth uses. Define models with `db.model(...)`.
 */
export type Database = Connection;

export interface Stores {
  store: AuthStore;
  rateLimitStore?: RateLimitStore;
  /** Your routes' database client; undefined while running on the in-memory store. */
  db?: Database;
  close(): Promise<void>;
}

/**
 * MongoDB (Mongoose) when DATABASE_URL is set, otherwise in-memory.
 * Never creates indexes or seeds on startup (DATA-MODEL-003, AUTHZ-RBAC-005):
 * run `npm run db:migrate` and `npm run db:seed` first.
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
    console.log("Using in-memory store (set DATABASE_URL to use MongoDB).");
    return { store: memory, close: async () => {} };
  }
  const connection = await createMongooseConnection(databaseUrl).asPromise();
  const store = new MongooseAuthStore(connection);
  const rateLimitStore = new MongooseRateLimitStore(connection);
  // The unique email index is what keeps accounts unique (DATA-MODEL-001): do not run without it.
  const missing = await missingIndexes(store, rateLimitStore);
  if (missing.length) {
    await connection.close();
    throw new Error(
      `The database is missing indexes (${missing.map((m) => m.collection).join(", ")}). ` +
        "Run `npm run db:migrate && npm run db:seed` first.",
    );
  }
  for (const role of config.authorization.defaultRoles) {
    if (!(await store.roleExists(role))) {
      await connection.close();
      throw new Error(
        `Role '${role}' is missing in the database. Run the migrations and \`npm run db:seed\` first.`,
      );
    }
  }
  console.log("Using MongoDB (Mongoose) store.");
  return { store, rateLimitStore, db: connection, close: () => connection.close() };
}
