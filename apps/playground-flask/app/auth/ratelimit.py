"""The rate limiter (SEC-RATE-001..006, ADR 0015).

A fixed window with exponential back-off: each key allows `limit` hits per window. The hit that
reaches the limit starts a block lasting window x 2^(strikes-1), capped at 24 hours; strikes reset
after 24 hours without a block. Blocks are always temporary (SEC-RATE-003).
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, replace
from typing import Callable, Protocol

from .clock import Clock, millis

DAY_MS = 24 * 60 * 60 * 1000
MAX_BLOCK_MS = DAY_MS
STRIKE_DECAY_MS = DAY_MS


@dataclass
class RateLimitRecord:
    """The state of one limiter key. Times are Unix milliseconds."""

    count: int = 0
    window_ends_at: int = 0
    blocked_until: int = 0
    strikes: int = 0
    last_block_at: int = 0


class RateLimitStore(Protocol):
    """Holds limiter state. Use a shared store across instances in production (SEC-RATE-006).

    `update` MUST be atomic per key: concurrent updates of one key are serialized, so parallel
    attempts cannot all read the same count. `fn` receives the current record (None if none) and
    returns the record to store, or None to leave the key unchanged.
    """

    def update(self, key: str, fn: Callable[[RateLimitRecord | None], RateLimitRecord | None]) -> None: ...

    def delete(self, key: str) -> None: ...


class MemoryRateLimitStore:
    """Per-process; correct only for a single application instance."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._records: dict[str, RateLimitRecord] = {}

    def update(self, key: str, fn: Callable[[RateLimitRecord | None], RateLimitRecord | None]) -> None:
        with self._lock:
            current = self._records.get(key)
            nxt = fn(replace(current) if current else None)
            if nxt is not None:
                self._records[key] = nxt

    def delete(self, key: str) -> None:
        with self._lock:
            self._records.pop(key, None)


@dataclass(frozen=True)
class LimitRule:
    limit: int
    window_seconds: int


@dataclass
class LimitResult:
    allowed: bool = False
    retry_after_seconds: int = 0
    # True when this call started a new block (the rate_limit.triggered event).
    just_blocked: bool = False


def _load(existing: RateLimitRecord | None, rule: LimitRule, now: int) -> RateLimitRecord:
    window_ms = rule.window_seconds * 1000
    if existing is None:
        return RateLimitRecord(window_ends_at=now + window_ms)
    record = replace(existing)
    if now >= record.window_ends_at and now >= record.blocked_until:
        record.count = 0
        record.window_ends_at = now + window_ms
    if record.strikes > 0 and now - record.last_block_at >= STRIKE_DECAY_MS:
        record.strikes = 0
    return record


class RateLimiter:
    def __init__(self, store: RateLimitStore, clock: Clock) -> None:
        self._store = store
        self._clock = clock

    def hit(self, key: str, rule: LimitRule) -> LimitResult:
        """Counts a hit. Rejected (and not counted) while blocked."""
        now = millis(self._clock.now())
        result = LimitResult()

        def apply(current: RateLimitRecord | None) -> RateLimitRecord | None:
            record = _load(current, rule, now)
            if record.blocked_until > now:
                result.allowed = False
                result.retry_after_seconds = max(1, (record.blocked_until - now + 999) // 1000)
                return None
            record.count += 1
            just_blocked = False
            if record.count >= rule.limit:
                record.strikes += 1
                duration = rule.window_seconds * 1000
                for _ in range(1, record.strikes):
                    if duration >= MAX_BLOCK_MS:
                        break
                    duration *= 2
                duration = min(duration, MAX_BLOCK_MS)
                record.blocked_until = now + duration
                record.last_block_at = now
                just_blocked = True
            result.allowed = True
            result.just_blocked = just_blocked
            return record

        self._store.update(key, apply)
        return result

    def reset(self, key: str) -> None:
        """Forgets a key (a verified password ends guessing)."""
        self._store.delete(key)
