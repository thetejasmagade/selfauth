"""The time source. It is injected so expiry is testable."""

from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone
from typing import Protocol


def _truncate_ms(value: datetime) -> datetime:
    return value.replace(microsecond=value.microsecond // 1000 * 1000)


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        """Truncated to milliseconds, the precision of every stored and exposed date."""
        return _truncate_ms(datetime.now(timezone.utc))


class ManualClock:
    """Moves only when told to (tests and the conformance harness)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._current = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def now(self) -> datetime:
        with self._lock:
            return self._current

    def advance(self, delta: timedelta) -> None:
        with self._lock:
            self._current = self._current + delta


def iso(value: datetime) -> str:
    """Formats like JavaScript's Date#toISOString, the wire format of every date."""
    value = value.astimezone(timezone.utc)
    return value.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}Z"


_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def millis(value: datetime) -> int:
    """Unix milliseconds, computed with integers so no float rounding creeps in."""
    return (value - _EPOCH) // timedelta(milliseconds=1)


def from_millis(value: int) -> datetime:
    return _EPOCH + timedelta(milliseconds=value)
