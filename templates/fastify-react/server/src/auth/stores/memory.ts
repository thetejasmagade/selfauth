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

interface CredentialRecord {
  id: string;
  userId: string;
  type: "password";
  secretHash: string;
  createdAt: Date;
  updatedAt: Date;
}

interface UserRoleRecord {
  userId: string;
  role: string;
  assignedAt: Date;
  assignedBy: string | null;
}

/**
 * In-memory AuthStore for development and tests. Single-process only; data is
 * lost on restart. Each method completes synchronously between awaits, which
 * makes check-and-set operations atomic within one Node.js process
 * (DATA-MODEL-002). Use the Prisma or Mongoose store in production (Phase 4).
 */
export class MemoryAuthStore implements AuthStore {
  readonly users = new Map<string, UserRecord>();
  readonly credentials = new Map<string, CredentialRecord>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly tokens = new Map<string, OneTimeTokenRecord>();
  readonly roles = new Map<string, string[]>();
  readonly userRoles: UserRoleRecord[] = [];
  readonly events: SecurityEventRecord[] = [];
  private credentialSeq = 0;

  private copy<T extends object>(value: T): T {
    return structuredClone(value);
  }

  async createUser(input: { user: UserRecord; passwordHash: string; roles: string[] }) {
    const { user } = input;
    for (const existing of this.users.values()) {
      if (existing.emailNormalized !== null && existing.emailNormalized === user.emailNormalized) {
        throw new EmailTakenError(); // unique among non-deleted users (IDENT-EMAIL-003)
      }
    }
    for (const role of input.roles) {
      if (!this.roles.has(role)) throw new Error(`default role '${role}' is not synchronized`);
    }
    this.users.set(user.id, this.copy(user));
    this.credentials.set(`${user.id}:password`, {
      id: `cred-${++this.credentialSeq}`,
      userId: user.id,
      type: "password",
      secretHash: input.passwordHash,
      createdAt: user.createdAt,
      updatedAt: user.createdAt,
    });
    for (const role of input.roles) {
      this.userRoles.push({ userId: user.id, role, assignedAt: user.createdAt, assignedBy: null });
    }
    return this.copy(user);
  }

  async findUserById(id: string) {
    const user = this.users.get(id);
    return user ? this.copy(user) : null;
  }

  async findUserByEmail(emailNormalized: string) {
    for (const user of this.users.values()) {
      if (user.emailNormalized === emailNormalized && user.state !== "deleted")
        return this.copy(user);
    }
    return null;
  }

  async updateUser(id: string, patch: Partial<Omit<UserRecord, "id">>) {
    const user = this.users.get(id);
    if (user) Object.assign(user, patch);
  }

  async getPasswordHash(userId: string) {
    return this.credentials.get(`${userId}:password`)?.secretHash ?? null;
  }

  async setPasswordHash(userId: string, hash: string, at: Date) {
    const existing = this.credentials.get(`${userId}:password`);
    if (existing) {
      existing.secretHash = hash;
      existing.updatedAt = at;
    } else {
      this.credentials.set(`${userId}:password`, {
        id: `cred-${++this.credentialSeq}`,
        userId,
        type: "password",
        secretHash: hash,
        createdAt: at,
        updatedAt: at,
      });
    }
  }

  async deleteCredentials(userId: string) {
    for (const [key, cred] of this.credentials)
      if (cred.userId === userId) this.credentials.delete(key);
  }

  async createSession(session: SessionRecord) {
    this.sessions.set(session.id, this.copy(session));
  }

  async findSessionByTokenHash(tokenHash: string) {
    for (const s of this.sessions.values()) if (s.tokenHash === tokenHash) return this.copy(s);
    return null;
  }

  async findSessionById(id: string) {
    const s = this.sessions.get(id);
    return s ? this.copy(s) : null;
  }

  async touchSession(id: string, lastSeenAt: Date, idleExpiresAt: Date) {
    const s = this.sessions.get(id);
    if (s && !s.revokedAt) Object.assign(s, { lastSeenAt, idleExpiresAt });
  }

  async revokeSession(id: string, reason: SessionRevokedReason, at: Date) {
    const s = this.sessions.get(id);
    if (s && !s.revokedAt) Object.assign(s, { revokedAt: at, revokedReason: reason });
  }

  async revokeUserSessions(
    userId: string,
    reason: SessionRevokedReason,
    at: Date,
    exceptSessionId?: string,
  ) {
    let count = 0;
    for (const s of this.sessions.values()) {
      if (s.userId === userId && !s.revokedAt && s.id !== exceptSessionId) {
        Object.assign(s, { revokedAt: at, revokedReason: reason });
        count += 1;
      }
    }
    return count;
  }

  async listActiveSessions(userId: string, now: Date) {
    return [...this.sessions.values()]
      .filter(
        (s) =>
          s.userId === userId && !s.revokedAt && now < s.idleExpiresAt && now < s.absoluteExpiresAt,
      )
      .map((s) => this.copy(s));
  }

  async createToken(token: OneTimeTokenRecord) {
    this.tokens.set(token.id, this.copy(token));
  }

  async findToken(kind: OneTimeTokenKind, tokenHash: string) {
    for (const t of this.tokens.values()) {
      if (t.kind === kind && t.tokenHash === tokenHash) return this.copy(t);
    }
    return null;
  }

  async consumeToken(id: string, now: Date) {
    const t = this.tokens.get(id);
    if (!t || t.usedAt || t.invalidatedAt || now >= t.expiresAt) return false;
    t.usedAt = now;
    return true;
  }

  async invalidateUserTokens(userId: string, kind: OneTimeTokenKind | "all", at: Date) {
    for (const t of this.tokens.values()) {
      if (
        t.userId === userId &&
        (kind === "all" || t.kind === kind) &&
        !t.usedAt &&
        !t.invalidatedAt
      ) {
        t.invalidatedAt = at;
      }
    }
  }

  async syncRoles(roles: ReadonlyMap<string, readonly string[]>) {
    this.roles.clear();
    for (const [name, perms] of roles) this.roles.set(name, [...perms]);
  }

  async getUserRoles(userId: string) {
    return this.userRoles.filter((r) => r.userId === userId).map((r) => r.role);
  }

  async getRolePermissions(roles: readonly string[]) {
    return [...new Set(roles.flatMap((r) => this.roles.get(r) ?? []))];
  }

  async roleExists(role: string) {
    return this.roles.has(role);
  }

  async addUserRole(userId: string, role: string, assignedBy: string | null, at: Date) {
    if (!this.userRoles.some((r) => r.userId === userId && r.role === role)) {
      this.userRoles.push({ userId, role, assignedAt: at, assignedBy });
    }
  }

  async removeUserRole(userId: string, role: string) {
    const i = this.userRoles.findIndex((r) => r.userId === userId && r.role === role);
    if (i >= 0) this.userRoles.splice(i, 1);
  }

  async countActiveUsersWithRole(role: string) {
    return this.userRoles.filter(
      (r) => r.role === role && this.users.get(r.userId)?.state === "active",
    ).length;
  }

  async recordEvent(event: SecurityEventRecord) {
    this.events.push(this.copy(event));
  }

  // ───────── inspection (tests and conformance drivers only) ─────────

  /** Records of a logical entity (DATA_MODEL.md names), users enriched with role names. */
  inspect(entity: string): Record<string, unknown>[] {
    const all = (): object[] => {
      switch (entity) {
        case "user":
          return [...this.users.values()].map((u) => ({
            ...u,
            roles: this.userRoles.filter((r) => r.userId === u.id).map((r) => r.role),
          }));
        case "credential":
          return [...this.credentials.values()];
        case "session":
          return [...this.sessions.values()];
        case "passwordResetToken":
          return [...this.tokens.values()].filter((t) => t.kind === "passwordReset");
        case "emailVerificationToken":
          return [...this.tokens.values()].filter((t) => t.kind === "emailVerification");
        default:
          throw new Error(`unknown entity '${entity}'`);
      }
    };
    return all().map((r) => structuredClone(r) as Record<string, unknown>);
  }

  /** Directly modifies records, bypassing services (conformance `mutateStorage`). */
  mutate(
    entity: string,
    match: (record: Record<string, unknown>) => boolean,
    set: Record<string, unknown>,
  ): void {
    const source: Iterable<object> =
      entity === "user"
        ? this.users.values()
        : entity === "session"
          ? this.sessions.values()
          : entity === "credential"
            ? this.credentials.values()
            : this.tokens.values();
    for (const record of source) {
      if (match(record as Record<string, unknown>)) Object.assign(record, set);
    }
  }
}
