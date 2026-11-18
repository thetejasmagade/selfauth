import mongoose, { Schema, type Connection, type Model } from "mongoose";
import type { RateLimitRecord, RateLimitStore } from "../core/rate-limit.ts";
import {
  EmailTakenError,
  type AccountState,
  type AuthStore,
  type OneTimeTokenKind,
  type OneTimeTokenRecord,
  type SecurityEventRecord,
  type SessionRecord,
  type SessionRevokedReason,
  type UserRecord,
} from "../core/store.ts";

/**
 * MongoDB AuthStore backed by Mongoose. Atomicity (DATA-MODEL-002) without transactions, so it
 * works on a standalone server as well as a replica set:
 * - the credential and the role links are embedded in the user document, so creating a user is
 *   one write (all or nothing);
 * - token consumption and session revocation are conditional updates;
 * - rate-limit counters are updated with compare-and-swap on a version number, retried on a clash.
 * Indexes are created by `npm run db:migrate`, never at start-up (DATA-MODEL-003); start-up
 * refuses to run without them, because the unique email index is what keeps accounts unique.
 */

/** Lookup keys must be strings: an object here would be a query operator (NoSQL injection). */
function text(value: unknown, what: string): string {
  if (typeof value !== "string") throw new TypeError(`${what} must be a string`);
  return value;
}

const schemaOptions = { versionKey: false, autoIndex: false, autoCreate: false } as const;

interface CredentialDoc {
  secretHash: string;
  createdAt: Date;
  updatedAt: Date;
}
interface UserRoleDoc {
  name: string;
  assignedAt: Date;
  assignedBy: string | null;
}
interface UserDoc {
  _id: string;
  email: string | null;
  emailNormalized: string | null;
  emailVerifiedAt: Date | null;
  state: AccountState;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /** Kept out of every UserRecord (IDENT-PROFILE-002); read only by getPasswordHash. */
  credential: CredentialDoc | null;
  roles: UserRoleDoc[];
}
interface SessionDoc extends Omit<SessionRecord, "id"> {
  _id: string;
}
interface TokenDoc extends Omit<OneTimeTokenRecord, "id"> {
  _id: string;
}
interface RoleDoc {
  /** The role's name. */
  _id: string;
  isSystem: boolean;
  permissions: string[];
}
interface EventDoc extends SecurityEventRecord {
  _id?: unknown;
}
interface RateLimitDoc {
  /** The limiter's key. */
  _id: string;
  count: number;
  windowEndsAt: Date;
  blockedUntil: Date;
  strikes: number;
  lastBlockAt: Date;
  /** Compare-and-swap version. */
  v: number;
}

const credentialSchema = new Schema<CredentialDoc>(
  { secretHash: String, createdAt: Date, updatedAt: Date },
  { _id: false },
);
const userRoleSchema = new Schema<UserRoleDoc>(
  { name: String, assignedAt: Date, assignedBy: { type: String, default: null } },
  { _id: false },
);
const userSchema = new Schema<UserDoc>(
  {
    _id: { type: String, required: true },
    email: { type: String, default: null },
    emailNormalized: { type: String, default: null },
    emailVerifiedAt: { type: Date, default: null },
    state: { type: String, required: true },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
    deletedAt: { type: Date, default: null },
    credential: { type: credentialSchema, default: null },
    roles: { type: [userRoleSchema], default: [] },
  },
  { ...schemaOptions, collection: "auth_users" },
);
// Unique among non-deleted users: the address is cleared on deletion (IDENT-EMAIL-003).
userSchema.index(
  { emailNormalized: 1 },
  { unique: true, partialFilterExpression: { emailNormalized: { $type: "string" } } },
);
userSchema.index({ "roles.name": 1 });

const sessionSchema = new Schema<SessionDoc>(
  {
    _id: { type: String, required: true },
    tokenHash: { type: String, required: true },
    userId: { type: String, required: true },
    createdAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    idleExpiresAt: { type: Date, required: true },
    absoluteExpiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
    reauthenticatedAt: { type: Date, default: null },
  },
  { ...schemaOptions, collection: "auth_sessions" },
);
sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ userId: 1 });
sessionSchema.index({ absoluteExpiresAt: 1 });

const tokenSchema = new Schema<TokenDoc>(
  {
    _id: { type: String, required: true },
    kind: { type: String, required: true },
    userId: { type: String, required: true },
    tokenHash: { type: String, required: true },
    email: { type: String, default: null },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    invalidatedAt: { type: Date, default: null },
    createdAt: { type: Date, required: true },
  },
  { ...schemaOptions, collection: "auth_one_time_tokens" },
);
tokenSchema.index({ kind: 1, tokenHash: 1 }, { unique: true });
tokenSchema.index({ userId: 1 });

const roleSchema = new Schema<RoleDoc>(
  {
    _id: { type: String, required: true },
    isSystem: { type: Boolean, default: false },
    permissions: { type: [String], default: [] },
  },
  { ...schemaOptions, collection: "auth_roles" },
);

/** Append-only audit log (SEC-AUDIT-004). Insertion order is the ObjectId order of `_id`. */
const eventSchema = new Schema<EventDoc>(
  {
    id: { type: String, required: true },
    type: { type: String, required: true },
    outcome: { type: String, required: true },
    occurredAt: { type: Date, required: true },
    userId: { type: String, default: null },
    actorId: { type: String, default: null },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
    requestId: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { ...schemaOptions, collection: "auth_security_events", minimize: false },
);
eventSchema.index({ occurredAt: 1 });
eventSchema.index({ userId: 1 });

const rateLimitSchema = new Schema<RateLimitDoc>(
  {
    _id: { type: String, required: true },
    count: { type: Number, required: true },
    windowEndsAt: { type: Date, required: true },
    blockedUntil: { type: Date, required: true },
    strikes: { type: Number, required: true },
    lastBlockAt: { type: Date, required: true },
    v: { type: Number, required: true },
  },
  { ...schemaOptions, collection: "auth_rate_limits" },
);

/** What index management needs from a model, whatever its document type. */
interface IndexedModel {
  collection: { name: string };
  schema: { indexes(): unknown[] };
  diffIndexes(): Promise<{ toCreate: unknown[] }>;
  createIndexes(): Promise<unknown>;
}

/** Opens a connection to `url` (a `mongodb://` or `mongodb+srv://` URL, DATABASE_URL). */
export function createMongooseConnection(url: string, options: { max?: number } = {}): Connection {
  return mongoose.createConnection(url, {
    maxPoolSize: options.max ?? 10,
    serverSelectionTimeoutMS: 8000,
  });
}

const isDuplicateKey = (error: unknown, field?: string): boolean => {
  const e = error as { code?: number; keyPattern?: Record<string, unknown> } | null;
  if (e?.code !== 11000) return false;
  return field === undefined || (e.keyPattern !== undefined && field in e.keyPattern);
};

const toUser = (doc: UserDoc): UserRecord => ({
  id: doc._id,
  email: doc.email,
  emailNormalized: doc.emailNormalized,
  emailVerifiedAt: doc.emailVerifiedAt,
  state: doc.state,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
  deletedAt: doc.deletedAt,
});
const toSession = ({ _id, ...rest }: SessionDoc): SessionRecord => ({ id: _id, ...rest });
const toToken = ({ _id, ...rest }: TokenDoc): OneTimeTokenRecord => ({ id: _id, ...rest });

export class MongooseAuthStore implements AuthStore {
  readonly connection: Connection;
  readonly users: Model<UserDoc>;
  readonly sessions: Model<SessionDoc>;
  readonly tokens: Model<TokenDoc>;
  readonly roles: Model<RoleDoc>;
  readonly events: Model<EventDoc>;

  constructor(connection: Connection) {
    this.connection = connection;
    this.users = connection.model<UserDoc>("AuthUser", userSchema);
    this.sessions = connection.model<SessionDoc>("AuthSession", sessionSchema);
    this.tokens = connection.model<TokenDoc>("AuthOneTimeToken", tokenSchema);
    this.roles = connection.model<RoleDoc>("AuthRole", roleSchema);
    this.events = connection.model<EventDoc>("AuthSecurityEvent", eventSchema);
  }

  /** Every model whose indexes `db:migrate` manages (the rate-limit store adds its own). */
  models(): IndexedModel[] {
    return [
      this.users,
      this.sessions,
      this.tokens,
      this.roles,
      this.events,
    ] as unknown as IndexedModel[];
  }

  // ── users ──
  async createUser(input: {
    user: UserRecord;
    passwordHash: string;
    roles: string[];
  }): Promise<UserRecord> {
    const { user } = input;
    // Checked before anything is written, so a missing role leaves nothing behind (AUTHN-REG-003).
    for (const role of input.roles) {
      if (!(await this.roleExists(role))) throw new Error(`role '${role}' does not exist`);
    }
    try {
      // One document holds the user, the password credential and the role links: all or nothing.
      await this.users.create({
        _id: user.id,
        email: user.email,
        emailNormalized: user.emailNormalized,
        emailVerifiedAt: user.emailVerifiedAt,
        state: user.state,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        deletedAt: user.deletedAt,
        credential: {
          secretHash: input.passwordHash,
          createdAt: user.createdAt,
          updatedAt: user.createdAt,
        },
        roles: input.roles.map((name) => ({
          name,
          assignedAt: user.createdAt,
          assignedBy: null,
        })),
      });
    } catch (error) {
      if (isDuplicateKey(error, "emailNormalized")) throw new EmailTakenError();
      throw error;
    }
    return user;
  }

  async findUserById(id: string) {
    const doc = await this.users.findById(text(id, "id")).select("-credential").lean();
    return doc ? toUser(doc as UserDoc) : null;
  }

  async findUserByEmail(emailNormalized: string) {
    const doc = await this.users
      .findOne({ emailNormalized: text(emailNormalized, "email"), state: { $ne: "deleted" } })
      .select("-credential")
      .lean();
    return doc ? toUser(doc as UserDoc) : null;
  }

  async updateUser(id: string, patch: Partial<Omit<UserRecord, "id">>) {
    const set = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(set).length === 0) return;
    await this.users.updateOne({ _id: text(id, "id") }, { $set: set });
  }

  // ── credentials ──
  async getPasswordHash(userId: string) {
    const doc = await this.users
      .findById(text(userId, "userId"))
      .select({ "credential.secretHash": 1 })
      .lean();
    return (doc as UserDoc | null)?.credential?.secretHash ?? null;
  }

  async setPasswordHash(userId: string, hash: string, at: Date) {
    // An aggregation-pipeline update: one atomic write that keeps the original creation time.
    await this.users.updateOne({ _id: text(userId, "userId") }, [
      {
        $set: {
          credential: {
            secretHash: text(hash, "hash"),
            createdAt: { $ifNull: ["$credential.createdAt", at] },
            updatedAt: at,
          },
        },
      },
    ]);
  }

  async deleteCredentials(userId: string) {
    await this.users.updateOne({ _id: text(userId, "userId") }, { $set: { credential: null } });
  }

  // ── sessions ──
  async createSession(session: SessionRecord) {
    const { id, ...rest } = session;
    await this.sessions.create({ _id: id, ...rest });
  }

  async findSessionByTokenHash(tokenHash: string) {
    const doc = await this.sessions.findOne({ tokenHash: text(tokenHash, "tokenHash") }).lean();
    return doc ? toSession(doc as SessionDoc) : null;
  }

  async findSessionById(id: string) {
    const doc = await this.sessions.findById(text(id, "id")).lean();
    return doc ? toSession(doc as SessionDoc) : null;
  }

  async touchSession(id: string, lastSeenAt: Date, idleExpiresAt: Date) {
    await this.sessions.updateOne({ _id: text(id, "id") }, { $set: { lastSeenAt, idleExpiresAt } });
  }

  async revokeSession(id: string, reason: SessionRevokedReason, at: Date) {
    await this.sessions.updateOne(
      { _id: text(id, "id"), revokedAt: null },
      { $set: { revokedAt: at, revokedReason: reason } },
    );
  }

  async revokeUserSessions(
    userId: string,
    reason: SessionRevokedReason,
    at: Date,
    exceptSessionId?: string,
  ) {
    const result = await this.sessions.updateMany(
      {
        userId: text(userId, "userId"),
        revokedAt: null,
        ...(exceptSessionId ? { _id: { $ne: text(exceptSessionId, "id") } } : {}),
      },
      { $set: { revokedAt: at, revokedReason: reason } },
    );
    return result.modifiedCount;
  }

  async listActiveSessions(userId: string, now: Date) {
    const docs = await this.sessions
      .find({
        userId: text(userId, "userId"),
        revokedAt: null,
        idleExpiresAt: { $gt: now },
        absoluteExpiresAt: { $gt: now },
      })
      .sort({ createdAt: 1 })
      .lean();
    return (docs as SessionDoc[]).map(toSession);
  }

  // ── one-time tokens ──
  async createToken(token: OneTimeTokenRecord) {
    const { id, ...rest } = token;
    await this.tokens.create({ _id: id, ...rest });
  }

  async findToken(kind: OneTimeTokenKind, tokenHash: string): Promise<OneTimeTokenRecord | null> {
    const doc = await this.tokens
      .findOne({
        kind: text(kind, "kind") as OneTimeTokenKind,
        tokenHash: text(tokenHash, "tokenHash"),
      })
      .lean();
    return doc ? toToken(doc as TokenDoc) : null;
  }

  async consumeToken(id: string, now: Date) {
    // Conditional update: at most one concurrent caller succeeds (AUTHN-RESET-009, AUTHN-VERIFY-006).
    const result = await this.tokens.updateOne(
      { _id: text(id, "id"), usedAt: null, invalidatedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
    );
    return result.modifiedCount === 1;
  }

  async invalidateUserTokens(userId: string, kind: OneTimeTokenKind | "all", at: Date) {
    await this.tokens.updateMany(
      {
        userId: text(userId, "userId"),
        usedAt: null,
        invalidatedAt: null,
        ...(kind === "all" ? {} : { kind }),
      },
      { $set: { invalidatedAt: at } },
    );
  }

  // ── roles ──
  /**
   * Upserts configured roles and makes each configured role's permissions exact. Roles no longer
   * in configuration are kept (deleting them would silently strip users' roles); remove them
   * with a reviewed change (AUTHZ-RBAC-005, DATA-MODEL-004).
   */
  async syncRoles(roles: ReadonlyMap<string, readonly string[]>) {
    if (roles.size === 0) return;
    await this.roles.bulkWrite(
      [...roles].map(([name, permissions]) => ({
        updateOne: {
          filter: { _id: name },
          update: {
            $set: {
              permissions: [...new Set(permissions)],
              isSystem: name === "admin" || name === "user",
            },
          },
          upsert: true,
        },
      })),
    );
  }

  async getUserRoles(userId: string) {
    const doc = await this.users.findById(text(userId, "userId")).select({ roles: 1 }).lean();
    return ((doc as UserDoc | null)?.roles ?? []).map((r) => r.name);
  }

  async getRolePermissions(roles: readonly string[]) {
    if (roles.length === 0) return [];
    const docs = await this.roles.find({ _id: { $in: roles.map((r) => text(r, "role")) } }).lean();
    return [...new Set((docs as RoleDoc[]).flatMap((d) => d.permissions))];
  }

  async roleExists(role: string) {
    return (await this.roles.countDocuments({ _id: text(role, "role") }).limit(1)) > 0;
  }

  async addUserRole(userId: string, role: string, assignedBy: string | null, at: Date) {
    if (!(await this.roleExists(role))) throw new Error(`role '${role}' does not exist`);
    // Atomic and idempotent: the filter matches only a user who does not have the role yet.
    await this.users.updateOne(
      { _id: text(userId, "userId"), "roles.name": { $ne: role } },
      { $push: { roles: { name: role, assignedAt: at, assignedBy } } },
    );
  }

  async removeUserRole(userId: string, role: string) {
    await this.users.updateOne(
      { _id: text(userId, "userId") },
      { $pull: { roles: { name: text(role, "role") } } },
    );
  }

  countActiveUsersWithRole(role: string) {
    return this.users.countDocuments({ state: "active", "roles.name": text(role, "role") });
  }

  // ── audit ──
  async recordEvent(event: SecurityEventRecord) {
    await this.events.create(event);
  }
}

/** Shared MongoDB rate-limit store (SEC-RATE-006): compare-and-swap on a version number. */
export class MongooseRateLimitStore implements RateLimitStore {
  readonly model: Model<RateLimitDoc>;

  constructor(connection: Connection) {
    this.model = connection.model<RateLimitDoc>("AuthRateLimit", rateLimitSchema);
  }

  async update<T>(
    key: string,
    fn: (current: RateLimitRecord | undefined) => { next?: RateLimitRecord; result: T },
  ): Promise<T> {
    const id = text(key, "key");
    // Concurrent updates of one key serialize: only one compare-and-swap wins, the rest re-read.
    for (let attempt = 0; attempt < 100; attempt++) {
      const doc = (await this.model.findById(id).lean()) as RateLimitDoc | null;
      const current: RateLimitRecord | undefined = doc
        ? {
            count: doc.count,
            windowEndsAt: doc.windowEndsAt.getTime(),
            blockedUntil: doc.blockedUntil.getTime(),
            strikes: doc.strikes,
            lastBlockAt: doc.lastBlockAt.getTime(),
          }
        : undefined;
      const { next, result } = fn(current);
      if (!next) return result;
      const fields = {
        count: next.count,
        windowEndsAt: new Date(next.windowEndsAt),
        blockedUntil: new Date(next.blockedUntil),
        strikes: next.strikes,
        lastBlockAt: new Date(next.lastBlockAt),
      };
      if (!doc) {
        try {
          await this.model.create({ _id: id, ...fields, v: 1 });
          return result;
        } catch (error) {
          if (isDuplicateKey(error)) continue; // another request created the row first
          throw error;
        }
      }
      const swapped = await this.model.updateOne(
        { _id: id, v: doc.v },
        { $set: { ...fields, v: doc.v + 1 } },
      );
      if (swapped.modifiedCount === 1) return result;
    }
    throw new Error("rate-limit counter is too contended to update");
  }

  async delete(key: string) {
    await this.model.deleteOne({ _id: text(key, "key") });
  }
}

/**
 * The indexes a database needs and does not have yet, for `db:migrate --plan` and the start-up
 * check. A collection that does not exist yet has none.
 */
export async function missingIndexes(
  store: MongooseAuthStore,
  rateLimits: MongooseRateLimitStore,
): Promise<{ collection: string; indexes: string[] }[]> {
  const out: { collection: string; indexes: string[] }[] = [];
  for (const model of [...store.models(), rateLimits.model as unknown as IndexedModel]) {
    let toCreate: Record<string, unknown>[];
    try {
      toCreate = (await model.diffIndexes()).toCreate as Record<string, unknown>[];
    } catch (error) {
      if ((error as { code?: number }).code !== 26) throw error; // 26: collection not created yet
      toCreate = model.schema
        .indexes()
        .map((entry) => (entry as unknown[])[0] as Record<string, unknown>);
    }
    if (toCreate.length) {
      out.push({
        collection: model.collection.name,
        indexes: toCreate.map((spec) => JSON.stringify(spec)),
      });
    }
  }
  return out;
}

/** Creates the missing indexes. It never drops one. */
export async function createIndexes(
  store: MongooseAuthStore,
  rateLimits: MongooseRateLimitStore,
): Promise<void> {
  for (const model of [...store.models(), rateLimits.model as unknown as IndexedModel]) {
    await model.createIndexes();
  }
}
