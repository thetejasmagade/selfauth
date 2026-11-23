import type { RateLimitStore } from "../src/auth/core/rate-limit.ts";
import type { AuthStore } from "../src/auth/core/store.ts";
import {
  createPrismaClient,
  PrismaAuthStore,
  PrismaRateLimitStore,
} from "../src/auth/stores/prisma.ts";
import { readSecurityEvents } from "./conformance/events.ts";
import { createTestSchema, TEST_DATABASE_URL, type TestSchema } from "./postgres.ts";

type Row = Record<string, unknown>;

/**
 * A database for one test: a fresh PostgreSQL schema with the migrations applied. The conformance
 * driver and the helpers see only this interface, so another database (scripts/dialect-conformance.mjs)
 * replaces this file and nothing else.
 */
export interface TestDatabase {
  store: AuthStore;
  rateLimitStore: RateLimitStore;
  /** Logical entities (DATA_MODEL.md) read back for `inspectStorage`. */
  inspect(entity: string): Promise<Row[]>;
  /** Changes stored fields directly (`mutateStorage`): only users and sessions. */
  mutate(entity: string, where: Row, set: Row): Promise<void>;
  /** Security events in insertion order. */
  events(): Promise<Row[]>;
  close(): Promise<void>;
  /** Prisma-specific handles for the store tests (postgres.test.ts). */
  prisma?: PrismaAuthStore;
  schema?: TestSchema;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const schema = await createTestSchema();
  const db = createPrismaClient({
    connectionString: TEST_DATABASE_URL!,
    schema: schema.schema,
    max: 4,
  });
  const prisma = new PrismaAuthStore(db);
  return {
    store: prisma,
    rateLimitStore: new PrismaRateLimitStore(db),
    prisma,
    schema,
    async inspect(entity) {
      switch (entity) {
        case "user": {
          const users = await db.authUser.findMany({
            include: { roles: { include: { role: true } } },
            orderBy: { createdAt: "asc" },
          });
          return users.map(({ roles, ...u }) => ({ ...u, roles: roles.map((r) => r.role.name) }));
        }
        case "credential":
          return db.authCredential.findMany({ orderBy: { createdAt: "asc" } });
        case "session":
          return db.authSession.findMany({ orderBy: { createdAt: "asc" } });
        case "passwordResetToken":
          return db.authPasswordResetToken.findMany({ orderBy: { createdAt: "asc" } });
        case "emailVerificationToken":
          return db.authEmailVerificationToken.findMany({ orderBy: { createdAt: "asc" } });
        default:
          throw new Error(`unknown entity '${entity}'`);
      }
    },
    async mutate(entity, where, set) {
      if (entity !== "user" && entity !== "session")
        throw new Error(`mutateStorage: unsupported entity '${entity}'`);
      // Test-only escape hatch: field names come from the case and are checked by Prisma at runtime.
      if (entity === "user")
        await db.authUser.updateMany({ where: where as never, data: set as never });
      else await db.authSession.updateMany({ where: where as never, data: set as never });
    },
    events: () => readSecurityEvents(prisma),
    async close() {
      await db.$disconnect();
      await schema.drop();
    },
  };
}
