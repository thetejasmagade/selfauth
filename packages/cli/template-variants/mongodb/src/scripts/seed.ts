/* eslint-disable no-console */
/**
 * Synchronizes configured roles and permissions into the database
 * (AUTHZ-RBAC-005). Run explicitly after `npm run db:migrate`: `npm run db:seed`.
 */
import { syncRoles } from "../auth/index.ts";
import { createMongooseConnection, MongooseAuthStore } from "../auth/stores/mongoose.ts";
import { config } from "../config/selfauth.config.ts";

const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL is required");
const connection = await createMongooseConnection(url)
  .asPromise()
  .catch((error: Error) => {
    console.error(`Could not connect to MongoDB: ${error.message}`);
    process.exit(1);
  });
try {
  await syncRoles(new MongooseAuthStore(connection), config);
  console.log(`Synchronized roles: ${Object.keys(config.authorization.roles).join(", ")}`);
} finally {
  await connection.close();
}
