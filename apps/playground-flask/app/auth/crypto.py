"""Random tokens, ids and digests."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import uuid


def random_token() -> str:
    """A 256-bit CSPRNG token, base64url (SEC-TOKEN-001)."""
    return secrets.token_urlsafe(32)


def new_id() -> str:
    """A random RFC 4122 version 4 UUID."""
    return str(uuid.uuid4())


def sha256_hex(value: str) -> str:
    """The digest stored for tokens; raw tokens are never stored (SEC-TOKEN-002)."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hmac_sha256(key: bytes, value: str) -> str:
    """base64url(HMAC-SHA-256(key, value)), unpadded."""
    digest = hmac.new(key, value.encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def safe_equal(a: str, b: str) -> bool:
    """Compares in constant time."""
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
