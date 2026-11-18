/* eslint-disable no-console */
/**
 * Creates the indexes SelfAuth needs (the unique email index above all). MongoDB has no SQL
 * migrations: this only ever creates indexes, never drops one or touches your data.
 *
 *   npm run db:migrate            create the missing indexes
 *   npm run db:migrate -- --plan  show what would be created, change nothing
 */
import {
  createIndexes,
  createMongooseConnection,
  missingIndexes,
  MongooseAuthStore,
  MongooseRateLimitStore,
} from "../auth/stores/mongoose.ts";

const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL is required");
const connection = await createMongooseConnection(url)
  .asPromise()
  .catch((error: Error) => {
    console.error(`Could not connect to MongoDB: ${error.message}`);
    process.exit(1);
  });
try {
  const store = new MongooseAuthStore(connection);
  const rateLimits = new MongooseRateLimitStore(connection);
  const missing = await missingIndexes(store, rateLimits);
  if (process.argv.includes("--plan")) {
    if (!missing.length) console.log("Nothing to do: every index exists.");
    for (const { collection, indexes } of missing) {
      for (const index of indexes) console.log(`would create on ${collection}: ${index}`);
    }
  } else {
    await createIndexes(store, rateLimits);
    console.log(
      missing.length
        ? `Created indexes on: ${missing.map((m) => m.collection).join(", ")}`
        : "Every index already exists.",
    );
  }
} finally {
  await connection.close();
}
