import { randomBytes } from "node:crypto";
import type { RateLimitStore } from "../src/auth/core/rate-limit.ts";
import type { AuthStore } from "../src/auth/core/store.ts";
import {
  createIndexes,
  createMongooseConnection,
  MongooseAuthStore,
  MongooseRateLimitStore,
} from "../src/auth/stores/mongoose.ts";
import { TEST_DATABASE_URL } from "./postgres.ts";

type Row = Record<string, unknown>;

/** The same shape as test/database.ts (PostgreSQL), which this file replaces for a MongoDB run. */
export interface TestDatabase {
  store: AuthStore;
  rateLimitStore: RateLimitStore;
  inspect(entity: string): Promise<Row[]>;
  mutate(entity: string, where: Row, set: Row): Promise<void>;
  events(): Promise<Row[]>;
  close(): Promise<void>;
}

/** A database for one test: a fresh MongoDB database with the indexes `db:migrate` creates. */
export async function createTestDatabase(): Promise<TestDatabase> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/t_${randomBytes(6).toString("hex")}`;
  const connection = await createMongooseConnection(url.toString(), { max: 4 }).asPromise();
  const mongo = new MongooseAuthStore(connection);
  const rateLimitStore = new MongooseRateLimitStore(connection);
  await createIndexes(mongo, rateLimitStore);

  const withoutKind = ({ _id, kind: _kind, email, ...rest }: Row) => ({
    id: _id,
    ...rest,
    ...(typeof email === "string" ? { email } : {}),
  });
  return {
    store: mongo,
    rateLimitStore,
    async inspect(entity) {
      switch (entity) {
        case "user": {
          const users = await mongo.users.find().sort({ createdAt: 1 }).lean();
          return users.map(({ _id, credential: _credential, roles, ...u }) => ({
            id: _id,
            ...u,
            roles: roles.map((r) => r.name),
          }));
        }
        case "credential": {
          const users = await mongo.users
            .find({ credential: { $ne: null } })
            .sort({ createdAt: 1 })
            .lean();
          return users.map((u) => ({ userId: u._id, type: "password", ...u.credential }));
        }
        case "session": {
          const sessions = await mongo.sessions.find().sort({ createdAt: 1 }).lean();
          return sessions.map(({ _id, ...s }) => ({ id: _id, ...s }));
        }
        case "passwordResetToken":
        case "emailVerificationToken": {
          const kind = entity === "passwordResetToken" ? "passwordReset" : "emailVerification";
          const tokens = await mongo.tokens.find({ kind }).sort({ createdAt: 1 }).lean();
          return tokens.map((t) => withoutKind(t as unknown as Row));
        }
        default:
          throw new Error(`unknown entity '${entity}'`);
      }
    },
    async mutate(entity, where, set) {
      if (entity !== "user" && entity !== "session")
        throw new Error(`mutateStorage: unsupported entity '${entity}'`);
      const { id, ...rest } = where;
      const filter = { ...rest, ...(id === undefined ? {} : { _id: id }) } as never;
      const model = entity === "user" ? mongo.users : mongo.sessions;
      await (model as typeof mongo.users).updateMany(filter, { $set: set } as never);
    },
    async events() {
      const events = await mongo.events.find().sort({ _id: 1 }).lean();
      return events.map(({ _id: _unused, ...e }) => e as Row);
    },
    async close() {
      await connection.dropDatabase();
      await connection.close();
    },
  };
}
