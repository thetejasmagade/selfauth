/**
 * Persistence contract for the authentication core (DATA_MODEL.md).
 * Implementations: stores/memory.ts (dev/test); Prisma and Mongoose in Phase 4.
 * Methods documented as atomic MUST be atomic in the database (DATA-MODEL-002).
 */

export type AccountState = "pending" | "active" | "suspended" | "disabled" | "deleted";

export interface UserRecord {
  id: string;
  email: string | null;
  emailNormalized: string | null;
  emailVerifiedAt: Date | null;
  state: AccountState;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type SessionRevokedReason =
  | "logout"
  | "logout_all"
  | "password_changed"
  | "password_reset"
  | "state_changed"
  | "admin"
  | "rotated";

export interface SessionRecord {
  id: string;
  tokenHash: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  revokedReason: SessionRevokedReason | null;
  ipAddress: string | null;
  userAgent: string | null;
  reauthenticatedAt: Date | null;
}

export type OneTimeTokenKind = "passwordReset" | "emailVerification";

export interface OneTimeTokenRecord {
  id: string;
  kind: OneTimeTokenKind;
  userId: string;
  tokenHash: string;
  /** Email verification only: normalized address the token was issued for. */
  email: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  invalidatedAt: Date | null;
  createdAt: Date;
}

export interface SecurityEventRecord {
  id: string;
  type: string;
  outcome: "success" | "failure";
  occurredAt: Date;
  userId: string | null;
  actorId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, string | number | boolean | null>;
}

/** Raised by createUser when the normalized email is already taken (DATA-MODEL-001). */
export class EmailTakenError extends Error {
  override name = "EmailTakenError";
}

export interface AuthStore {
  /** Atomic: creates user, password credential and role links, or nothing (AUTHN-REG-003). */
  createUser(input: {
    user: UserRecord;
    passwordHash: string;
    roles: string[];
  }): Promise<UserRecord>;
  findUserById(id: string): Promise<UserRecord | null>;
  /** Non-deleted user by normalized email. */
  findUserByEmail(emailNormalized: string): Promise<UserRecord | null>;
  updateUser(id: string, patch: Partial<Omit<UserRecord, "id">>): Promise<void>;

  getPasswordHash(userId: string): Promise<string | null>;
  setPasswordHash(userId: string, hash: string, at: Date): Promise<void>;
  deleteCredentials(userId: string): Promise<void>;

  createSession(session: SessionRecord): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  findSessionById(id: string): Promise<SessionRecord | null>;
  touchSession(id: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void>;
  revokeSession(id: string, reason: SessionRevokedReason, at: Date): Promise<void>;
  /** Revokes all of the user's active sessions, optionally keeping one. Returns the count. */
  revokeUserSessions(
    userId: string,
    reason: SessionRevokedReason,
    at: Date,
    exceptSessionId?: string,
  ): Promise<number>;
  listActiveSessions(userId: string, now: Date): Promise<SessionRecord[]>;

  createToken(token: OneTimeTokenRecord): Promise<void>;
  findToken(kind: OneTimeTokenKind, tokenHash: string): Promise<OneTimeTokenRecord | null>;
  /** Atomic conditional consume: succeeds only if unused, not invalidated and unexpired. */
  consumeToken(id: string, now: Date): Promise<boolean>;
  invalidateUserTokens(userId: string, kind: OneTimeTokenKind | "all", at: Date): Promise<void>;

  /** Explicit role synchronization (AUTHZ-RBAC-005). */
  syncRoles(roles: ReadonlyMap<string, readonly string[]>): Promise<void>;
  getUserRoles(userId: string): Promise<string[]>;
  getRolePermissions(roles: readonly string[]): Promise<string[]>;
  roleExists(role: string): Promise<boolean>;
  addUserRole(userId: string, role: string, assignedBy: string | null, at: Date): Promise<void>;
  removeUserRole(userId: string, role: string): Promise<void>;
  /** Active users holding a role. */
  countActiveUsersWithRole(role: string): Promise<number>;

  /** Append-only (SEC-AUDIT-004). */
  recordEvent(event: SecurityEventRecord): Promise<void>;
}
