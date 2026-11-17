import type { Clock } from "./clock.ts";

/**
 * Fixed-window rate limiter with exponential back-off (SEC-RATE-001…006,
 * ADR 0015). Keys are opaque strings such as `login:acct:<email>`.
 *
 * Semantics: each key allows `limit` hits per window. The hit that reaches the
 * limit starts a block lasting `window × 2^(strikes-1)` (capped at 24 h);
 * strikes reset after 24 h without a block. Blocks are always temporary
 * (SEC-RATE-003).
 */
export interface RateLimitRecord {
  count: number;
  windowEndsAt: number;
  blockedUntil: number;
  strikes: number;
  lastBlockAt: number;
}

/**
 * Storage for limiter state. Use a shared store across instances in
 * production (SEC-RATE-006). `update` MUST be atomic per key: concurrent
 * updates of one key are serialized, so parallel attempts cannot all read
 * the same count.
 */
export interface RateLimitStore {
  update<T>(
    key: string,
    fn: (current: RateLimitRecord | undefined) => { next?: RateLimitRecord; result: T },
  ): Promise<T>;
  delete(key: string): Promise<void>;
}

/** Per-process store. Only correct for a single application instance. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly records = new Map<string, RateLimitRecord>();
  async update<T>(
    key: string,
    fn: (current: RateLimitRecord | undefined) => { next?: RateLimitRecord; result: T },
  ): Promise<T> {
    // Synchronous read-modify-write: atomic within one Node.js process.
    const { next, result } = fn(this.records.get(key));
    if (next) this.records.set(key, next);
    return result;
  }
  async delete(key: string) {
    this.records.delete(key);
  }
}

export interface LimitRule {
  limit: number;
  windowSeconds: number;
}

export interface LimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  /** True when this call started a new block (used for the rate_limit.triggered event). */
  justBlocked: boolean;
}

const MAX_BLOCK_MS = 24 * 60 * 60 * 1000;
const STRIKE_DECAY_MS = 24 * 60 * 60 * 1000;

export class RateLimiter {
  private readonly store: RateLimitStore;
  private readonly clock: Clock;

  constructor(store: RateLimitStore, clock: Clock) {
    this.store = store;
    this.clock = clock;
  }

  private load(
    existing: RateLimitRecord | undefined,
    rule: LimitRule,
    now: number,
  ): RateLimitRecord {
    const windowMs = rule.windowSeconds * 1000;
    if (!existing) {
      return {
        count: 0,
        windowEndsAt: now + windowMs,
        blockedUntil: 0,
        strikes: 0,
        lastBlockAt: 0,
      };
    }
    const record = { ...existing };
    if (now >= record.windowEndsAt && now >= record.blockedUntil) {
      record.count = 0;
      record.windowEndsAt = now + windowMs;
    }
    if (record.strikes > 0 && now - record.lastBlockAt >= STRIKE_DECAY_MS) record.strikes = 0;
    return record;
  }

  private blocked(record: RateLimitRecord, now: number): LimitResult | undefined {
    if (record.blockedUntil > now) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((record.blockedUntil - now) / 1000)),
        justBlocked: false,
      };
    }
    return undefined;
  }

  /** Whether the key is currently blocked, without counting a hit. */
  async check(key: string, rule: LimitRule): Promise<LimitResult> {
    const now = this.clock.now().getTime();
    return this.store.update(key, (current) => ({
      result: this.blocked(this.load(current, rule, now), now) ?? {
        allowed: true,
        retryAfterSeconds: 0,
        justBlocked: false,
      },
    }));
  }

  /** Count a hit. Rejected (and not counted) while blocked. */
  async hit(key: string, rule: LimitRule): Promise<LimitResult> {
    const now = this.clock.now().getTime();
    return this.store.update(key, (current) => {
      const record = this.load(current, rule, now);
      const blocked = this.blocked(record, now);
      if (blocked) return { result: blocked };
      record.count += 1;
      let justBlocked = false;
      if (record.count >= rule.limit) {
        record.strikes += 1;
        const duration = Math.min(
          rule.windowSeconds * 1000 * 2 ** (record.strikes - 1),
          MAX_BLOCK_MS,
        );
        record.blockedUntil = now + duration;
        record.lastBlockAt = now;
        justBlocked = true;
      }
      return { next: record, result: { allowed: true, retryAfterSeconds: 0, justBlocked } };
    });
  }

  async reset(key: string): Promise<void> {
    await this.store.delete(key);
  }
}
