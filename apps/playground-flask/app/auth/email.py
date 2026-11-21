"""Email normalization and validation (IDENT-EMAIL-001..004)."""

from __future__ import annotations

import unicodedata

# What JavaScript's trim() and \s treat as white space, so every implementation
# accepts and rejects the same addresses.
_JS_SPACE = frozenset(
    "\t\n\v\f\r       　﻿"
    + "".join(chr(c) for c in range(0x2000, 0x200B))
)


def _trim(value: str) -> str:
    start, end = 0, len(value)
    while start < end and value[start] in _JS_SPACE:
        start += 1
    while end > start and value[end - 1] in _JS_SPACE:
        end -= 1
    return value[start:end]


def normalize_email(value: str) -> str:
    """Trims, applies NFC and lower-cases (IDENT-EMAIL-001). No provider-specific rules."""
    return unicodedata.normalize("NFC", _trim(value)).lower()


def validate_email(value: object) -> str | None:
    """The trimmed address, or None when it is not acceptable (IDENT-EMAIL-004)."""
    if not isinstance(value, str):
        return None
    email = _trim(value)
    if email == "" or len(email.encode("utf-16-le")) // 2 > 254:
        return None
    for ch in email:
        if ch in _JS_SPACE or unicodedata.category(ch) in ("Cc", "Cf"):
            return None
    at = email.rfind("@")
    if at <= 0 or at == len(email) - 1:
        return None
    if email.find("@") != at:  # exactly one "@"
        return None
    return email
