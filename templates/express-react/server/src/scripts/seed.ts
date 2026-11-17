/* eslint-disable no-console */
/**
 * Synchronizes configured roles and permissions into the database
 * (AUTHZ-RBAC-005). Run explicitly after migrating: `pnpm db:seed`.
 */
import { syncRoles } from "../auth/index.ts";
import { createPrismaClient, PrismaAuthStore } from "../auth/stores/prisma.ts";
import { config } from "../config/selfauth.config.ts";

const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL is required");
const db = createPrismaClient({ connectionString: url });
try {
  await syncRoles(new PrismaAuthStore(db), config);
  console.log(`Synchronized roles: ${Object.keys(config.authorization.roles).join(", ")}`);
} finally {
  await db.$disconnect();
}
