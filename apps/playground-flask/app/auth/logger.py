"""A structured logger with mandatory redaction (SEC-LOG-001)."""

from __future__ import annotations

import json
import re
import sys
import threading
from datetime import datetime, timezone
from typing import Any, Protocol

from .clock import iso

_REDACTED_KEYS = frozenset(
    {
        "password", "currentpassword", "newpassword", "token", "csrftoken", "cookie", "set-cookie",
        "authorization", "secret", "secrethash", "passwordhash", "tokenhash",
    }
)
# 32+ character base64url/hex runs look like tokens or hashes; never log them.
_TOKEN_LIKE = re.compile(r"[A-Za-z0-9_-]{32,}")
_UUID_LIKE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


def redact(value: Any, depth: int = 0) -> Any:
    """`value` with secrets removed. UUIDs (request, user and session ids) are identifiers, not
    secrets, and are kept for correlation (SEC-LOG-003)."""
    if depth > 8:
        return "[depth]"
    if isinstance(value, str):
        return _TOKEN_LIKE.sub(lambda m: m.group(0) if _UUID_LIKE.match(m.group(0)) else "[redacted]", value)
    if isinstance(value, BaseException):
        return {"message": redact(str(value), depth + 1)}
    if isinstance(value, (list, tuple)):
        return [redact(e, depth + 1) for e in value]
    if isinstance(value, dict):
        return {
            k: "[redacted]" if str(k).lower() in _REDACTED_KEYS else redact(e, depth + 1)
            for k, e in value.items()
        }
    return value


class LogSink(Protocol):
    def write(self, line: str) -> None: ...


class StdoutSink:
    def __init__(self) -> None:
        self._lock = threading.Lock()

    def write(self, line: str) -> None:
        with self._lock:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()


class MemoryLogSink:
    """Collects lines in memory (tests, the conformance inspectLogs view)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._lines: list[str] = []

    def write(self, line: str) -> None:
        with self._lock:
            self._lines.append(line)

    def lines(self) -> list[str]:
        with self._lock:
            return list(self._lines)


class Logger:
    """Writes redacted JSON lines."""

    def __init__(self, sink: LogSink | None = None) -> None:
        self._sink = sink or StdoutSink()

    def log(self, level: str, message: str, fields: dict[str, Any] | None = None) -> None:
        entry: dict[str, Any] = dict(redact(fields or {}))
        entry["level"] = level
        entry["time"] = iso(datetime.now(timezone.utc))
        entry["message"] = message
        try:
            line = json.dumps(entry, separators=(",", ":"), default=str)
        except (TypeError, ValueError):
            line = '{"level":"error","message":"log entry could not be encoded"}'
        self._sink.write(line)
