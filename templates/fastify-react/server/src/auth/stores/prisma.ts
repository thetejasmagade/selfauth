import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import type { RateLimitRecord, RateLimitStore } from "../core/rate-limit.ts";
import {
  EmailTakenError,
  type AuthStore,
  type OneTimeTokenKind,
  type OneTimeTokenRecord,
  type SecurityEventRecord,
  type SessionRecord,
  type SessionRevokedReason,
  type UserRecord,
} from "../core/store.ts";

/**
 * PostgreSQL AuthStore backed by Prisma (Phase 4). Atomicity (DATA-MODEL-002):
 * user creation runs in one transaction, token consumption and session
 * revocation are conditional updates, and rate-limit updates lock their row.
 */
export function createPrismaClient(options: {
  connectionString: string;
  schema?: string;
  max?: number;
}): PrismaClient {
  if (options.schema && !/^[a-z_][a-z0-9_]*$/.test(options.schema))
    throw new Error("invalid schema name");
  const adapter = new PrismaPg(
    {
      connectionString: options.connectionString,
      ...(options.max ? { max: options.max } : {}),
      // Raw SQL (rate limits) resolves unqualified names through search_path.
      ...(options.schema ? { options: `-c search_path=${options.schema}` } : {}),
    },
    options.schema ? { schema: options.schema } : undefined,
  );
  return new PrismaClient({ adapter });
}

function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
    return false;
  return JSON.stringify(error.meta ?? {}).includes(field);
}

type Tx = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id: string): boolean => UUID.test(id);

export class PrismaAuthStore implements AuthStore {
  readonly db: PrismaClient;

  constructor(db: PrismaClient) {
    this.db = db;
  }

  // ── users ──
  async createUser(input: {
    user: UserRecord;
    passwordHash: string;
    roles: string[];
  }): Promise<UserRecord> {
    const { user } = input;
    try {
      // All-or-nothing: user, password credential and default roles (AUTHN-REG-003).
      return await this.db.$transaction(async (tx: Tx) => {
        const roles = await tx.authRole.findMany({ where: { name: { in: input.roles } } });
        if (roles.length !== new Set(input.roles).size) {
          throw new Error(`default roles are not synchronized: ${input.roles.join(", ")}`);
        }
        const created = await tx.authUser.create({ data: user });
        await tx.authCredential.create({
          data: {
            userId: user.id,
            type: "password",
            secretHash: input.passwordHash,
            createdAt: user.createdAt,
            updatedAt: user.createdAt,
          },
        });
        await tx.authUserRole.createMany({
          data: roles.map((r) => ({ userId: user.id, roleId: r.id, assignedAt: user.createdAt })),
        });
        return created;
      });
    } catch (error) {
      if (
        isUniqueViolation(error, "email_normalized") ||
        isUniqueViolation(error, "emailNormalized")
      ) {
        throw new EmailTakenError();
      }
      throw error;
    }
  }

  async findUserById(id: string) {
    // Ids are `uuid` columns and PostgreSQL raises an error for any other text. An id of another
    // shape cannot exist, so it is "not found", the same as in the in-memory store.
    return isUuid(id) ? this.db.authUser.findUnique({ where: { id } }) : null;
  }

  findUserByEmail(emailNormalized: string) {
    return this.db.authUser.findFirst({ where: { emailNormalized, state: { not: "deleted" } } });
  }

  async updateUser(id: string, patch: Partial<Omit<UserRecord, "id">>) {
    await this.db.authUser.updateMany({ where: { id }, data: patch });
  }

  // ── credentials ──
  async getPasswordHash(userId: string) {
    const cred = await this.db.authCredential.findUnique({
      where: { userId_type: { userId, type: "password" } },
    });
    return cred?.secretHash ?? null;
  }

  async setPasswordHash(userId: string, hash: string, at: Date) {
    await this.db.authCredential.upsert({
      where: { userId_type: { userId, type: "password" } },
      update: { secretHash: hash, updatedAt: at },
      create: { userId, type: "password", secretHash: hash, createdAt: at, updatedAt: at },
    });
  }

  async deleteCredentials(userId: string) {
    await this.db.authCredential.deleteMany({ where: { userId } });
  }

  // ── sessions ──
  async createSession(session: SessionRecord) {
    await this.db.authSession.create({ data: session });
  }

  findSessionByTokenHash(tokenHash: string) {
    return this.db.authSession.findUnique({ where: { tokenHash } });
  }

  async findSessionById(id: string) {
    return isUuid(id) ? this.db.authSession.findUnique({ where: { id } }) : null;
  }

  async touchSession(id: string, lastSeenAt: Date, idleExpiresAt: Date) {
    await this.db.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { lastSeenAt, idleExpiresAt },
    });
  }

  async revokeSession(id: string, reason: SessionRevokedReason, at: Date) {
    await this.db.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at, revokedReason: reason },
    });
  }

  async revokeUserSessions(
    userId: string,
    reason: SessionRevokedReason,
    at: Date,
    exceptSessionId?: string,
  ) {
    const result = await this.db.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: at, revokedReason: reason },
    });
    return result.count;
  }

  listActiveSessions(userId: string, now: Date) {
    return this.db.authSession.findMany({
      where: {
        userId,
        revokedAt: null,
        idleExpiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  // ── one-time tokens (two tables, one logical contract) ──
  async createToken(token: OneTimeTokenRecord) {
    const { kind, email, ...common } = token;
    if (kind === "passwordReset") {
      await this.db.authPasswordResetToken.create({ data: common });
    } else {
      await this.db.authEmailVerificationToken.create({ data: { ...common, email: email ?? "" } });
    }
  }

  async findToken(kind: OneTimeTokenKind, tokenHash: string): Promise<OneTimeTokenRecord | null> {
    if (kind === "passwordReset") {
      const t = await this.db.authPasswordResetToken.findUnique({ where: { tokenHash } });
      return t ? { ...t, kind, email: null } : null;
    }
    const t = await this.db.authEmailVerificationToken.findUnique({ where: { tokenHash } });
    return t ? { ...t, kind } : null;
  }

  async consumeToken(id: string, now: Date) {
    // Conditional update: at most one concurrent caller succeeds (AUTHN-RESET-009, AUTHN-VERIFY-006).
    const where = { id, usedAt: null, invalidatedAt: null, expiresAt: { gt: now } };
    const reset = await this.db.authPasswordResetToken.updateMany({ where, data: { usedAt: now } });
    if (reset.count === 1) return true;
    const verify = await this.db.authEmailVerificationToken.updateMany({
      where,
      data: { usedAt: now },
    });
    return verify.count === 1;
  }

  async invalidateUserTokens(userId: string, kind: OneTimeTokenKind | "all", at: Date) {
    const where = { userId, usedAt: null, invalidatedAt: null };
    const kinds: OneTimeTokenKind[] =
      kind === "all" ? ["passwordReset", "emailVerification"] : [kind];
    for (const k of kinds) {
      if (k === "passwordReset") {
        await this.db.authPasswordResetToken.updateMany({ where, data: { invalidatedAt: at } });
      } else {
        await this.db.authEmailVerificationToken.updateMany({ where, data: { invalidatedAt: at } });
      }
    }
  }

  // ── roles ──
  /**
   * Upserts configured roles/permissions and makes each configured role's
   * permissions exact. Roles and permissions no longer in configuration are
   * kept (deleting them would silently strip users' roles); remove them with
   * a reviewed migration (AUTHZ-RBAC-005, DATA-MODEL-004).
   */
  async syncRoles(roles: ReadonlyMap<string, readonly string[]>) {
    await this.db.$transaction(async (tx: Tx) => {
      const allPermissions = [...new Set([...roles.values()].flat())];
      for (const name of allPermissions) {
        await tx.authPermission.upsert({ where: { name }, update: {}, create: { name } });
      }
      const permissionIds = new Map(
        (await tx.authPermission.findMany({ where: { name: { in: allPermissions } } })).map((p) => [
          p.name,
          p.id,
        ]),
      );
      for (const [name, perms] of roles) {
        const role = await tx.authRole.upsert({
          where: { name },
          update: { isSystem: name === "admin" || name === "user" },
          create: { name, isSystem: name === "admin" || name === "user" },
        });
        const wanted = perms.map((p) => permissionIds.get(p)!);
        await tx.authRolePermission.deleteMany({
          where: { roleId: role.id, permissionId: { notIn: wanted } },
        });
        await linkRolePermissions(
          tx,
          wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
        );
      }
    });
  }

  async getUserRoles(userId: string) {
    const rows = await this.db.authUserRole.findMany({
      where: { userId },
      include: { role: true },
    });
    return rows.map((r) => r.role.name);
  }

  async getRolePermissions(roles: readonly string[]) {
    if (roles.length === 0) return [];
    const rows = await this.db.authRolePermission.findMany({
      where: { role: { name: { in: [...roles] } } },
      include: { permission: true },
    });
    return [...new Set(rows.map((r) => r.permission.name))];
  }

  async roleExists(role: string) {
    return (await this.db.authRole.count({ where: { name: role } })) > 0;
  }

  async addUserRole(userId: string, role: string, assignedBy: string | null, at: Date) {
    const found = await this.db.authRole.findUnique({ where: { name: role } });
    if (!found) throw new Error(`role '${role}' does not exist`);
    await linkUserRole(this.db, { userId, roleId: found.id, assignedAt: at, assignedBy });
  }

  async removeUserRole(userId: string, role: string) {
    await this.db.authUserRole.deleteMany({ where: { userId, role: { name: role } } });
  }

  countActiveUsersWithRole(role: string) {
    return this.db.authUserRole.count({
      where: { role: { name: role }, user: { state: "active" } },
    });
  }

  // ── audit ──
  async recordEvent(event: SecurityEventRecord) {
    await this.db.authSecurityEvent.create({ data: { ...event, metadata: event.metadata } });
  }
}

/** Adds role-permission links, skipping the ones that already exist. */
async function linkRolePermissions(
  tx: Tx,
  rows: { roleId: string; permissionId: string }[],
): Promise<void> {
  await tx.authRolePermission.createMany({ data: rows, skipDuplicates: true });
}

/** Gives a user a role; already having it is not an error. */
async function linkUserRole(
  db: PrismaClient | Tx,
  row: { userId: string; roleId: string; assignedAt: Date; assignedBy: string | null },
): Promise<void> {
  await db.authUserRole.createMany({ data: [row], skipDuplicates: true });
}

/**
 * Makes sure the row for `key` exists and locks it until the transaction ends, so concurrent
 * updates of one key serialize (a new row reads as `windowEndsAt === 0`).
 */
async function lockRateLimitRow(tx: Tx, key: string): Promise<RateLimitRecord> {
  await tx.$executeRaw`
    INSERT INTO auth_rate_limits (key, count, window_ends_at, blocked_until, strikes, last_block_at)
    VALUES (${key}, 0, to_timestamp(0), to_timestamp(0), 0, to_timestamp(0))
    ON CONFLICT (key) DO NOTHING`;
  const rows = await tx.$queryRaw<
    {
      count: number;
      window_ends_at: Date;
      blocked_until: Date;
      strikes: number;
      last_block_at: Date;
    }[]
  >`SELECT count, window_ends_at, blocked_until, strikes, last_block_at
    FROM auth_rate_limits WHERE key = ${key} FOR UPDATE`;
  const row = rows[0]!;
  return {
    count: row.count,
    windowEndsAt: row.window_ends_at.getTime(),
    blockedUntil: row.blocked_until.getTime(),
    strikes: row.strikes,
    lastBlockAt: row.last_block_at.getTime(),
  };
}

/** Shared PostgreSQL rate-limit store (SEC-RATE-006); one row lock per key. */
export class PrismaRateLimitStore implements RateLimitStore {
  private readonly db: PrismaClient;

  constructor(db: PrismaClient) {
    this.db = db;
  }

  async update<T>(
    key: string,
    fn: (current: RateLimitRecord | undefined) => { next?: RateLimitRecord; result: T },
  ): Promise<T> {
    return this.db.$transaction(async (tx: Tx) => {
      const current = await lockRateLimitRow(tx, key);
      const { next, result } = fn(current.windowEndsAt === 0 ? undefined : current);
      if (next) {
        await tx.authRateLimit.update({
          where: { key },
          data: {
            count: next.count,
            windowEndsAt: new Date(next.windowEndsAt),
            blockedUntil: new Date(next.blockedUntil),
            strikes: next.strikes,
            lastBlockAt: new Date(next.lastBlockAt),
          },
        });
      }
      return result;
    });
  }

  async delete(key: string) {
    await this.db.authRateLimit.deleteMany({ where: { key } });
  }
}
