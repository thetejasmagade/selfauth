/* eslint-disable no-console */
/**
 * Grants the admin role to an existing, active account. The first
 * administrator can only be created by a developer-run command like this one,
 * never through the API (AUTHZ-ADMIN-005).
 *
 *   npm run db:create-admin you@example.com
 */
import { randomUUID } from "node:crypto";
import { normalizeEmail } from "../auth/core/email.ts";
import { createMongooseConnection, MongooseAuthStore } from "../auth/stores/mongoose.ts";

const url = process.env["DATABASE_URL"];
const email = process.argv[2];
if (!url || !email) throw new Error("usage: DATABASE_URL=… create-admin <email>");
const connection = await createMongooseConnection(url)
  .asPromise()
  .catch((error: Error) => {
    console.error(`Could not connect to MongoDB: ${error.message}`);
    process.exit(1);
  });
const store = new MongooseAuthStore(connection);
try {
  const user = await store.findUserByEmail(normalizeEmail(email));
  if (!user || user.state !== "active") {
    console.error("No active account with that email. Register and verify it first.");
    process.exitCode = 1;
  } else if (!(await store.roleExists("admin"))) {
    console.error("The admin role does not exist yet. Run `npm run db:seed` first.");
    process.exitCode = 1;
  } else {
    const now = new Date();
    await store.addUserRole(user.id, "admin", null, now);
    await store.recordEvent({
      id: randomUUID(),
      type: "role.assigned",
      outcome: "success",
      occurredAt: now,
      userId: user.id,
      actorId: null,
      ipAddress: null,
      userAgent: "selfauth create-admin",
      requestId: null,
      metadata: { role: "admin", via: "cli" },
    });
    console.log(`${email} is now an administrator.`);
  }
} finally {
  await connection.close();
}
