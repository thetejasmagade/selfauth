import { randomUUID } from "node:crypto";
import type { SelfAuthConfig } from "@selfauth/spec";
import { ADMIN_ROLE, type Subject } from "./authorization.ts";
import { MINUTE_MS, type Clock } from "./clock.ts";
import { randomToken, sha256 } from "./crypto.ts";
import { normalizeEmail, validateEmail } from "./email.ts";
import { AuthError, fail, MESSAGES } from "./errors.ts";
import type { EmailKind, Mailer } from "./mailer.ts";
import type { PasswordHasher } from "./password.ts";
import { checkPasswordPolicy } from "./password.ts";
import type { LimitRule, RateLimiter } from "./rate-limit.ts";
import {
  EmailTakenError,
  type AccountState,
  type AuthStore,
  type OneTimeTokenKind,
  type SecurityEventRecord,
  type SessionRecord,
  type UserRecord,
} from "./store.ts";

/** Per-request facts the service needs; supplied by the transport adapter. */
export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** A validated session plus the subject derived from server-side state. */
export interface AuthContext extends Subject {
  session: SessionRecord;
  user: UserRecord;
}

/** A newly created session. `token` goes only into the cookie (AUTHN-SESS-001). */
export interface IssuedSession {
  token: string;
  session: SessionRecord;
}

export interface PublicUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  state: AccountState;
  roles: string[];
  permissions: string[];
}

export type RegisterResult =
  { kind: "accepted" } | { kind: "signedIn"; user: PublicUser; issued: IssuedSession };

export interface AuthServiceDeps {
  config: SelfAuthConfig;
  store: AuthStore;
  mailer: Mailer;
  clock: Clock;
  hasher: PasswordHasher;
  limiter: RateLimiter;
  /** Absolute base URL for email links; never derived from request headers (AUTHN-VERIFY-009). */
  appBaseUrl: URL;
}

const ADMIN_TRANSITIONS: Readonly<Record<AccountState, readonly AccountState[]>> = {
  pending: ["disabled", "deleted"],
  active: ["suspended", "disabled", "deleted"],
  suspended: ["active", "disabled", "deleted"],
  disabled: ["active", "deleted"],
  deleted: [],
};

const ACCOUNT_STATES: readonly AccountState[] = [
  "pending",
  "active",
  "suspended",
  "disabled",
  "deleted",
];

export class AuthService {
  private readonly cfg: SelfAuthConfig["authentication"];
  private readonly deps: AuthServiceDeps;

  constructor(deps: AuthServiceDeps) {
    this.deps = deps;
    this.cfg = deps.config.authentication;
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private now(): Date {
    return this.deps.clock.now();
  }

  private async event(
    type: string,
    outcome: SecurityEventRecord["outcome"],
    ctx: RequestContext,
    fields: {
      userId?: string | null;
      actorId?: string | null;
      metadata?: SecurityEventRecord["metadata"];
    } = {},
  ): Promise<void> {
    await this.deps.store.recordEvent({
      id: randomUUID(),
      type,
      outcome,
      occurredAt: this.now(),
      userId: fields.userId ?? null,
      actorId: fields.actorId ?? null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: fields.metadata ?? {},
    });
  }

  /** Counts a hit; throws RATE_LIMITED when blocked. */
  private async limit(key: string, rule: LimitRule, ctx: RequestContext): Promise<void> {
    const result = await this.deps.limiter.hit(key, rule);
    if (result.justBlocked) await this.rateLimitEvent(key, ctx);
    if (!result.allowed) this.rateLimited(result.retryAfterSeconds);
  }

  private async checkLimit(key: string, rule: LimitRule): Promise<void> {
    const result = await this.deps.limiter.check(key, rule);
    if (!result.allowed) this.rateLimited(result.retryAfterSeconds);
  }

  private async countFailure(key: string, rule: LimitRule, ctx: RequestContext): Promise<void> {
    const result = await this.deps.limiter.hit(key, rule);
    if (result.justBlocked) await this.rateLimitEvent(key, ctx);
  }

  private rateLimitEvent(key: string, ctx: RequestContext): Promise<void> {
    // The key's scope (e.g. "login:acct") is logged; the identifier itself is not.
    return this.event("rate_limit.triggered", "failure", ctx, {
      metadata: { scope: key.split(":").slice(0, 2).join(":") },
    });
  }

  private rateLimited(retryAfterSeconds: number): never {
    throw new AuthError("RATE_LIMITED", MESSAGES.RATE_LIMITED, { retryAfterSeconds });
  }

  private requireEmail(input: unknown): { email: string; normalized: string } {
    const email = validateEmail(input);
    if (!email) {
      throw new AuthError("VALIDATION_FAILED", "Enter a valid email address.", {
        details: [{ field: "email", issue: "invalid_format" }],
      });
    }
    return { email, normalized: normalizeEmail(email) };
  }

  private requireString(input: unknown, field: string): string {
    if (typeof input !== "string" || input.length === 0) {
      throw new AuthError("VALIDATION_FAILED", `${field} is required.`, {
        details: [{ field, issue: "required" }],
      });
    }
    return input;
  }

  private link(path: string, token: string): string {
    const base = this.deps.appBaseUrl.href.endsWith("/")
      ? this.deps.appBaseUrl.href
      : `${this.deps.appBaseUrl.href}/`;
    const url = new URL(path, base);
    // Fragment keeps the token out of server logs and Referer headers (SEC-TOKEN-005).
    url.hash = `token=${token}`;
    return url.href;
  }

  private async sendMail(
    kind: EmailKind,
    to: string,
    subject: string,
    text: string,
    extra: { link?: string; token?: string } = {},
  ): Promise<void> {
    await this.deps.mailer.send({ kind, to, subject, text, ...extra });
  }

  private async issueToken(
    kind: OneTimeTokenKind,
    user: UserRecord,
    ttlMinutes: number,
  ): Promise<string> {
    const now = this.now();
    // A new token supersedes earlier unused ones (AUTHN-RESET-004, AUTHN-VERIFY-003).
    await this.deps.store.invalidateUserTokens(user.id, kind, now);
    const token = randomToken();
    await this.deps.store.createToken({
      id: randomUUID(),
      kind,
      userId: user.id,
      tokenHash: sha256(token),
      email: kind === "emailVerification" ? user.emailNormalized : null,
      expiresAt: new Date(now.getTime() + ttlMinutes * MINUTE_MS),
      usedAt: null,
      invalidatedAt: null,
      createdAt: now,
    });
    return token;
  }

  private async sendVerification(user: UserRecord): Promise<void> {
    if (!user.email) return;
    const token = await this.issueToken(
      "emailVerification",
      user,
      this.cfg.emailVerification.tokenTtlMinutes,
    );
    const link = this.link("verify-email", token);
    await this.sendMail(
      "verification",
      user.email,
      "Verify your email address",
      `Open this link to verify your email address: ${link}`,
      { link, token },
    );
  }

  private async createSession(user: UserRecord, ctx: RequestContext): Promise<IssuedSession> {
    const now = this.now();
    const { idleTimeoutMinutes, absoluteTimeoutMinutes } = this.cfg.sessions;
    const absoluteExpiresAt = new Date(now.getTime() + absoluteTimeoutMinutes * MINUTE_MS);
    const idleExpiresAt = new Date(
      Math.min(now.getTime() + idleTimeoutMinutes * MINUTE_MS, absoluteExpiresAt.getTime()),
    );
    const token = randomToken();
    const session: SessionRecord = {
      id: randomUUID(),
      tokenHash: sha256(token),
      userId: user.id,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt,
      absoluteExpiresAt,
      revokedAt: null,
      revokedReason: null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      reauthenticatedAt: now,
    };
    await this.deps.store.createSession(session);
    return { token, session };
  }

  async publicUser(user: UserRecord): Promise<PublicUser> {
    const roles = await this.deps.store.getUserRoles(user.id);
    const permissions = await this.deps.store.getRolePermissions(roles);
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      state: user.state,
      roles: [...roles].sort(),
      permissions: [...permissions].sort(),
    };
  }

  private async verifyCurrentPassword(
    auth: AuthContext,
    password: unknown,
    ctx: RequestContext,
  ): Promise<void> {
    const rules = this.cfg.rateLimit.passwordChange;
    await this.limit(`pwchg:addr:${ctx.ipAddress}`, rules.perAddress, ctx);
    await this.checkLimit(`pwchg:acct:${auth.userId}`, rules.perAccount);
    const hash = await this.deps.store.getPasswordHash(auth.userId);
    const ok =
      typeof password === "string" &&
      hash !== null &&
      (await this.deps.hasher.verify(hash, password));
    if (!ok) {
      await this.countFailure(`pwchg:acct:${auth.userId}`, rules.perAccount, ctx);
      fail("INVALID_CREDENTIALS");
    }
  }

  private requirePermission(auth: AuthContext, permission: string): void {
    if (!auth.permissions.has(permission)) fail("FORBIDDEN");
  }

  /** AUTHZ-ADMIN-004: admin operations need a recent password entry. */
  private requireRecentAuth(auth: AuthContext): void {
    const at = auth.session.reauthenticatedAt?.getTime() ?? 0;
    const windowMs = this.deps.config.authorization.reauthenticationWindowMinutes * MINUTE_MS;
    if (this.now().getTime() - at > windowMs) fail("REAUTHENTICATION_REQUIRED");
  }

  private async isLastActiveAdmin(user: UserRecord): Promise<boolean> {
    if (user.state !== "active") return false;
    const roles = await this.deps.store.getUserRoles(user.id);
    if (!roles.includes(ADMIN_ROLE)) return false;
    return (await this.deps.store.countActiveUsersWithRole(ADMIN_ROLE)) <= 1;
  }

  private async deleteUser(user: UserRecord, actorId: string, ctx: RequestContext): Promise<void> {
    const now = this.now();
    const { store } = this.deps;
    // IDENT-DELETE-001/002: tombstone, release the email, drop credentials, revoke everything.
    await store.updateUser(user.id, {
      state: "deleted",
      deletedAt: now,
      updatedAt: now,
      email: null,
      emailNormalized: null,
    });
    await store.deleteCredentials(user.id);
    await store.revokeUserSessions(user.id, "state_changed", now);
    await store.invalidateUserTokens(user.id, "all", now);
    await this.event("account.state_changed", "success", ctx, {
      userId: user.id,
      actorId,
      metadata: { from: user.state, to: "deleted" },
    });
  }

  /** Records csrf.rejected, at most once per client address per minute (SEC-CSRF-005). */
  async csrfRejected(ctx: RequestContext): Promise<void> {
    const result = await this.deps.limiter.hit(`csrf:addr:${ctx.ipAddress}`, {
      limit: 1,
      windowSeconds: 60,
    });
    if (result.allowed) await this.event("csrf.rejected", "failure", ctx);
  }

  // ─────────────────────────── registration ───────────────────────────

  async register(
    input: { email?: unknown; password?: unknown },
    ctx: RequestContext,
  ): Promise<RegisterResult> {
    const { email, normalized } = this.requireEmail(input.email);
    const password = checkPasswordPolicy(input.password, this.cfg.password, email);
    const rules = this.cfg.rateLimit.register;
    await this.limit(`register:addr:${ctx.ipAddress}`, rules.perAddress, ctx);
    await this.limit(`register:acct:${normalized}`, rules.perAccount, ctx);

    // Hash on every path so timing does not reveal existing accounts (AUTHN-REG-010).
    const passwordHash = await this.deps.hasher.hash(password);
    const { revealExistingEmail, signInAfterRegistration } = this.cfg.registration;

    const existing = await this.deps.store.findUserByEmail(normalized);
    if (existing) return this.registerExisting(existing, revealExistingEmail);

    const mode = this.cfg.emailVerification.mode;
    const now = this.now();
    let user: UserRecord;
    try {
      user = await this.deps.store.createUser({
        user: {
          // Only server-chosen values; client-supplied state/roles/id are ignored (AUTHN-REG-002).
          id: randomUUID(),
          email,
          emailNormalized: normalized,
          emailVerifiedAt: null,
          state: mode === "required" ? "pending" : "active",
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        passwordHash,
        roles: this.deps.config.authorization.defaultRoles,
      });
    } catch (error) {
      if (!(error instanceof EmailTakenError)) throw error;
      // Lost a concurrent race for the same email (AUTHN-REG-007).
      const winner = await this.deps.store.findUserByEmail(normalized);
      if (winner) return this.registerExisting(winner, revealExistingEmail);
      throw error;
    }

    await this.event("user.registered", "success", ctx, { userId: user.id });
    if (mode !== "off") await this.sendVerification(user);

    if (signInAfterRegistration) {
      const issued = await this.createSession(user, ctx);
      return { kind: "signedIn", user: await this.publicUser(user), issued };
    }
    return { kind: "accepted" };
  }

  private async registerExisting(existing: UserRecord, reveal: boolean): Promise<RegisterResult> {
    if (reveal) fail("EMAIL_TAKEN"); // AUTHN-REG-011 (opt-in)
    // AUTHN-REG-005: same outcome as a new registration; the owner is told instead.
    if (existing.email) {
      await this.sendMail(
        "accountExists",
        existing.email,
        "Someone tried to create an account with your email",
        "An account already exists for this address. If this was you, sign in or reset your password. Otherwise you can ignore this message.",
      );
    }
    return { kind: "accepted" };
  }

  // ─────────────────────────────── login ───────────────────────────────

  async login(
    input: { email?: unknown; password?: unknown },
    presentedToken: string | undefined,
    ctx: RequestContext,
  ): Promise<{ user: PublicUser; issued: IssuedSession }> {
    const { normalized } = this.requireEmail(input.email);
    const password = this.requireString(input.password, "password");
    const rules = this.cfg.rateLimit.login;
    await this.limit(`login:addr:${ctx.ipAddress}`, rules.perAddress, ctx);
    const accountKey = `login:acct:${normalized}`;
    // Applies whether or not the account exists (AUTHN-LOGIN-006, SEC-RATE-004).
    await this.checkLimit(accountKey, rules.perAccount);

    const { store, hasher } = this.deps;
    const user = await store.findUserByEmail(normalized);
    const storedHash = user ? await store.getPasswordHash(user.id) : null;
    let verified = false;
    if (storedHash && [...password].length <= this.cfg.password.maxLength) {
      verified = await hasher.verify(storedHash, password);
    } else {
      await hasher.verifyDummy(password); // AUTHN-LOGIN-003
    }

    if (!user || !verified) {
      await this.countFailure(accountKey, rules.perAccount, ctx);
      await this.event("auth.login.failed", "failure", ctx, { userId: user?.id ?? null });
      fail("INVALID_CREDENTIALS"); // AUTHN-LOGIN-002
    }

    // State is revealed only after the password is verified (AUTHN-LOGIN-004).
    if (user.state !== "active") {
      await this.event("auth.login.failed", "failure", ctx, {
        userId: user.id,
        metadata: { reason: user.state },
      });
      fail(user.state === "pending" ? "EMAIL_NOT_VERIFIED" : "ACCOUNT_UNAVAILABLE");
    }

    await this.deps.limiter.reset(accountKey);
    if (storedHash && hasher.needsRehash(storedHash)) {
      await store.setPasswordHash(user.id, await hasher.hash(password), this.now()); // SEC-HASH-004
    }

    // Never adopt a client-supplied session; revoke whatever was presented (AUTHN-LOGIN-005).
    if (presentedToken) {
      const previous = await store.findSessionByTokenHash(sha256(presentedToken));
      if (previous && !previous.revokedAt)
        await store.revokeSession(previous.id, "rotated", this.now());
    }
    const issued = await this.createSession(user, ctx);
    await this.event("auth.login.succeeded", "success", ctx, { userId: user.id });
    return { user: await this.publicUser(user), issued };
  }

  // ───────────────────────────── sessions ─────────────────────────────

  /** Validates a session token (AUTHN-SESS-003…006). Returns null when unauthenticated. */
  async authenticate(token: string | undefined): Promise<AuthContext | null> {
    if (!token) return null;
    const { store } = this.deps;
    const session = await store.findSessionByTokenHash(sha256(token));
    const now = this.now();
    if (
      !session ||
      session.revokedAt ||
      now >= session.idleExpiresAt ||
      now >= session.absoluteExpiresAt
    ) {
      return null;
    }
    const user = await store.findUserById(session.userId);
    if (!user || user.state !== "active") return null; // IDENT-STATE-004

    const sinceTouch = now.getTime() - session.lastSeenAt.getTime();
    if (sinceTouch >= this.cfg.sessions.touchIntervalSeconds * 1000) {
      // Sliding idle expiry, never beyond the absolute expiry (AUTHN-SESS-004).
      const idleExpiresAt = new Date(
        Math.min(
          now.getTime() + this.cfg.sessions.idleTimeoutMinutes * MINUTE_MS,
          session.absoluteExpiresAt.getTime(),
        ),
      );
      await store.touchSession(session.id, now, idleExpiresAt);
      session.lastSeenAt = now;
      session.idleExpiresAt = idleExpiresAt;
    }

    // Roles and permissions are read on every request (AUTHZ-CORE-006).
    const roles = await store.getUserRoles(user.id);
    const permissions = new Set(await store.getRolePermissions(roles));
    return { session, user, userId: user.id, roles, permissions };
  }

  async logout(token: string | undefined, ctx: RequestContext): Promise<void> {
    if (!token) return; // AUTHN-LOGOUT-003
    const session = await this.deps.store.findSessionByTokenHash(sha256(token));
    if (!session || session.revokedAt) return;
    await this.deps.store.revokeSession(session.id, "logout", this.now());
    await this.event("auth.logout", "success", ctx, { userId: session.userId });
  }

  async logoutAll(auth: AuthContext, ctx: RequestContext): Promise<void> {
    await this.deps.store.revokeUserSessions(auth.userId, "logout_all", this.now());
    await this.event("auth.sessions.revoked_all", "success", ctx, { userId: auth.userId });
  }

  async currentUser(auth: AuthContext) {
    return {
      user: await this.publicUser(auth.user),
      session: {
        id: auth.session.id,
        createdAt: auth.session.createdAt.toISOString(),
        idleExpiresAt: auth.session.idleExpiresAt.toISOString(),
        absoluteExpiresAt: auth.session.absoluteExpiresAt.toISOString(),
      },
    };
  }

  async listSessions(auth: AuthContext) {
    const sessions = await this.deps.store.listActiveSessions(auth.userId, this.now());
    return sessions.map((s) => ({
      id: s.id,
      current: s.id === auth.session.id,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      userAgent: s.userAgent,
    }));
  }

  async revokeSession(auth: AuthContext, sessionId: string, ctx: RequestContext): Promise<void> {
    const session = await this.deps.store.findSessionById(sessionId);
    if (!session || session.userId !== auth.userId || session.revokedAt) fail("NOT_FOUND");
    await this.deps.store.revokeSession(session.id, "logout", this.now());
    await this.event("auth.logout", "success", ctx, {
      userId: auth.userId,
      metadata: { sessionId: session.id },
    });
  }

  // ─────────────────────────── email verification ───────────────────────────

  async requestEmailVerification(input: { email?: unknown }, ctx: RequestContext): Promise<void> {
    const { normalized } = this.requireEmail(input.email);
    const rules = this.cfg.rateLimit.verificationResend;
    await this.limit(`verify:addr:${ctx.ipAddress}`, rules.perAddress, ctx);
    await this.limit(`verify:acct:${normalized}`, rules.perAccount, ctx);
    if (this.cfg.emailVerification.mode === "off") return;
    const user = await this.deps.store.findUserByEmail(normalized);
    // Same outcome whatever the account's status (AUTHN-VERIFY-001).
    if (
      user &&
      user.emailVerifiedAt === null &&
      (user.state === "pending" || user.state === "active")
    ) {
      await this.sendVerification(user);
    }
  }

  async verifyEmail(input: { token?: unknown }, ctx: RequestContext): Promise<void> {
    const raw = typeof input.token === "string" ? input.token : "";
    const { store } = this.deps;
    const now = this.now();
    const token = raw ? await store.findToken("emailVerification", sha256(raw)) : null;
    const user = token ? await store.findUserById(token.userId) : null;
    const valid =
      token &&
      user &&
      !token.usedAt &&
      !token.invalidatedAt &&
      now < token.expiresAt &&
      (user.state === "pending" || user.state === "active") &&
      token.email !== null &&
      token.email === user.emailNormalized; // AUTHN-VERIFY-005
    if (!valid || !(await store.consumeToken(token.id, now))) fail("TOKEN_INVALID");

    await store.updateUser(user.id, {
      emailVerifiedAt: now,
      updatedAt: now,
      ...(user.state === "pending" ? { state: "active" as const } : {}),
    });
    await this.event("email.verified", "success", ctx, { userId: user.id });
    if (user.state === "pending") {
      await this.event("account.state_changed", "success", ctx, {
        userId: user.id,
        actorId: user.id,
        metadata: { from: "pending", to: "active" },
      });
    }
  }

  // ─────────────────────────── password change ───────────────────────────

  async changePassword(
    auth: AuthContext,
    input: { currentPassword?: unknown; newPassword?: unknown },
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    await this.verifyCurrentPassword(auth, input.currentPassword, ctx);
    const next = checkPasswordPolicy(
      input.newPassword,
      this.cfg.password,
      auth.user.email ?? undefined,
    );
    const { store } = this.deps;
    const now = this.now();
    await store.setPasswordHash(auth.userId, await this.deps.hasher.hash(next), now);
    // AUTHN-PWCHG-003: other sessions revoked; the current one is replaced.
    await store.revokeUserSessions(auth.userId, "password_changed", now, auth.session.id);
    await store.revokeSession(auth.session.id, "rotated", now);
    const issued = await this.createSession(auth.user, ctx);
    await store.invalidateUserTokens(auth.userId, "passwordReset", now); // AUTHN-PWCHG-004
    await this.deps.limiter.reset(`pwchg:acct:${auth.userId}`);
    await this.event("password.changed", "success", ctx, { userId: auth.userId });
    if (auth.user.email) {
      await this.sendMail(
        "passwordChanged",
        auth.user.email,
        "Your password was changed",
        "Your password was just changed. If this was not you, reset your password immediately.",
      );
    }
    return issued;
  }

  // ─────────────────────────── password reset ───────────────────────────

  async requestPasswordReset(input: { email?: unknown }, ctx: RequestContext): Promise<void> {
    const { normalized } = this.requireEmail(input.email);
    const rules = this.cfg.rateLimit.passwordResetRequest;
    await this.limit(`reset:addr:${ctx.ipAddress}`, rules.perAddress, ctx);
    await this.limit(`reset:acct:${normalized}`, rules.perAccount, ctx);
    const user = await this.deps.store.findUserByEmail(normalized);
    // AUTHN-RESET-002: only active or pending accounts receive a token.
    if (!user || !user.email || (user.state !== "active" && user.state !== "pending")) return;
    const token = await this.issueToken(
      "passwordReset",
      user,
      this.cfg.passwordReset.tokenTtlMinutes,
    );
    const link = this.link("reset-password", token);
    await this.sendMail(
      "passwordReset",
      user.email,
      "Reset your password",
      `Open this link to choose a new password: ${link}\nIf you did not ask for this, ignore this email.`,
      { link, token },
    );
    await this.event("password.reset.requested", "success", ctx, { userId: user.id });
  }

  async resetPassword(
    input: { token?: unknown; newPassword?: unknown },
    ctx: RequestContext,
  ): Promise<void> {
    const raw = typeof input.token === "string" ? input.token : "";
    const { store } = this.deps;
    const token = raw ? await store.findToken("passwordReset", sha256(raw)) : null;
    const user = token ? await store.findUserById(token.userId) : null;
    const now = this.now();
    const usable =
      token &&
      user &&
      !token.usedAt &&
      !token.invalidatedAt &&
      now < token.expiresAt &&
      (user.state === "active" || user.state === "pending"); // AUTHN-RESET-007
    if (!usable) fail("TOKEN_INVALID");

    // Policy is checked before consuming, so a violation keeps the token usable (AUTHN-RESET-008).
    const next = checkPasswordPolicy(input.newPassword, this.cfg.password, user.email ?? undefined);
    const hash = await this.deps.hasher.hash(next);
    if (!(await store.consumeToken(token.id, now))) fail("TOKEN_INVALID"); // AUTHN-RESET-009

    await store.setPasswordHash(user.id, hash, now);
    if (user.state === "pending") {
      // AUTHN-RESET-011: the token proves control of the mailbox.
      await store.updateUser(user.id, { state: "active", emailVerifiedAt: now, updatedAt: now });
    }
    await store.revokeUserSessions(user.id, "password_reset", now); // AUTHN-RESET-010
    await store.invalidateUserTokens(user.id, "passwordReset", now);
    if (user.emailNormalized) await this.deps.limiter.reset(`login:acct:${user.emailNormalized}`);
    await this.event("password.reset.completed", "success", ctx, { userId: user.id });
    if (user.email) {
      await this.sendMail(
        "passwordResetCompleted",
        user.email,
        "Your password was reset",
        "Your password was just reset and all sessions were signed out. If this was not you, contact support.",
      );
    }
  }

  // ─────────────────────────── account deletion ───────────────────────────

  async deleteAccount(
    auth: AuthContext,
    input: { currentPassword?: unknown },
    ctx: RequestContext,
  ): Promise<void> {
    await this.verifyCurrentPassword(auth, input.currentPassword, ctx); // IDENT-DELETE-003
    if (await this.isLastActiveAdmin(auth.user)) fail("CONFLICT"); // AUTHZ-ADMIN-003
    await this.deleteUser(auth.user, auth.userId, ctx);
  }

  // ─────────────────────────── administration ───────────────────────────

  async setAccountState(
    auth: AuthContext,
    targetId: string,
    input: { state?: unknown },
    ctx: RequestContext,
  ): Promise<void> {
    this.requirePermission(auth, "auth.users.manage");
    this.requireRecentAuth(auth);
    const next = input.state as AccountState;
    if (!ACCOUNT_STATES.includes(next)) {
      throw new AuthError("VALIDATION_FAILED", "Unknown account state.", {
        details: [{ field: "state", issue: "invalid_value" }],
      });
    }
    const { store } = this.deps;
    const target = await store.findUserById(targetId);
    if (!target) fail("NOT_FOUND");
    if (!ADMIN_TRANSITIONS[target.state].includes(next)) fail("CONFLICT"); // IDENT-STATE-002
    if (next !== "active" && (await this.isLastActiveAdmin(target))) fail("CONFLICT");

    if (next === "deleted") {
      await this.deleteUser(target, auth.userId, ctx);
      return;
    }
    const now = this.now();
    await store.updateUser(target.id, { state: next, updatedAt: now });
    if (next !== "active") {
      // IDENT-STATE-003, AUTHZ-ADMIN-006
      await store.revokeUserSessions(target.id, "state_changed", now);
      await store.invalidateUserTokens(target.id, "all", now);
    }
    await this.event("account.state_changed", "success", ctx, {
      userId: target.id,
      actorId: auth.userId,
      metadata: { from: target.state, to: next },
    });
  }

  /** AUTHZ-ADMIN-002: without auth.roles.manage, only roles within the actor's own permissions. */
  private async requireDelegable(auth: AuthContext, role: string): Promise<void> {
    if (auth.permissions.has("auth.roles.manage")) return;
    const granted = await this.deps.store.getRolePermissions([role]);
    if (!granted.every((p) => auth.permissions.has(p))) fail("FORBIDDEN");
  }

  private async roleTarget(
    auth: AuthContext,
    targetId: string,
    role: unknown,
  ): Promise<[UserRecord, string]> {
    this.requirePermission(auth, "auth.roles.assign");
    this.requireRecentAuth(auth);
    if (typeof role !== "string" || !(await this.deps.store.roleExists(role))) fail("NOT_FOUND");
    const target = await this.deps.store.findUserById(targetId);
    if (!target || target.state === "deleted") fail("NOT_FOUND");
    await this.requireDelegable(auth, role);
    return [target, role];
  }

  async assignRole(
    auth: AuthContext,
    targetId: string,
    input: { role?: unknown },
    ctx: RequestContext,
  ): Promise<void> {
    const [target, role] = await this.roleTarget(auth, targetId, input.role);
    await this.deps.store.addUserRole(target.id, role, auth.userId, this.now());
    await this.event("role.assigned", "success", ctx, {
      userId: target.id,
      actorId: auth.userId,
      metadata: { role },
    });
  }

  async removeRole(
    auth: AuthContext,
    targetId: string,
    role: string,
    ctx: RequestContext,
  ): Promise<void> {
    const [target] = await this.roleTarget(auth, targetId, role);
    if (role === ADMIN_ROLE && (await this.isLastActiveAdmin(target))) fail("CONFLICT");
    await this.deps.store.removeUserRole(target.id, role);
    await this.event("role.removed", "success", ctx, {
      userId: target.id,
      actorId: auth.userId,
      metadata: { role },
    });
  }
}
