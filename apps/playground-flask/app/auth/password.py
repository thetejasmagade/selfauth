"""Argon2id hashing (SEC-HASH-001..006) and the password policy (SEC-PWPOLICY-001..006)."""

from __future__ import annotations

import base64
import hmac
import os
import threading
import unicodedata

from argon2.low_level import Type, hash_secret_raw

from ..config import Hashing, Password
from . import errors
from .common_passwords import COMMON_PASSWORDS

SALT_LENGTH = 16
KEY_LENGTH = 32
ARGON2_VERSION = 19  # 0x13, the only version in use


def _b64(data: bytes) -> str:
    return base64.b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text + "=" * (-len(text) % 4), validate=True)


def normalize_password(password: str) -> str:
    """NFKC only; never trimmed, case-folded or truncated (SEC-HASH-005)."""
    return unicodedata.normalize("NFKC", password)


class _Phc:
    __slots__ = ("memory", "iterations", "parallelism", "salt", "key")

    def __init__(self, memory: int, iterations: int, parallelism: int, salt: bytes, key: bytes) -> None:
        self.memory, self.iterations, self.parallelism, self.salt, self.key = (
            memory, iterations, parallelism, salt, key,
        )


def _parse_phc(encoded: str) -> _Phc | None:
    parts = encoded.split("$")
    if len(parts) != 6 or parts[0] != "" or parts[1] != "argon2id" or not parts[2].startswith("v="):
        return None
    try:
        if int(parts[2][2:]) != ARGON2_VERSION:
            return None
        values: dict[str, int] = {}
        for pair in parts[3].split(","):
            key, sep, value = pair.partition("=")
            if not sep or not value.isdigit():
                return None
            values[key] = int(value)
        memory, iterations, parallelism = values.get("m", 0), values.get("t", 0), values.get("p", 0)
        if memory == 0 or iterations == 0 or parallelism == 0 or parallelism > 255:
            return None
        salt, key = _unb64(parts[4]), _unb64(parts[5])
    except ValueError:
        return None
    if not key:
        return None
    return _Phc(memory, iterations, parallelism, salt, key)


class PasswordHasher:
    """Hashes with Argon2id and emits PHC strings with a random 16-byte salt.

    Concurrent hashes are bounded so a burst of requests cannot exhaust memory (SEC-HASH-006).
    """

    def __init__(self, params: Hashing) -> None:
        self._params = params
        self._slots = threading.BoundedSemaphore(max(2, (os.cpu_count() or 1) * 2))
        self._count_lock = threading.Lock()
        self._computations = 0
        self._dummy: str | None = None
        self._dummy_lock = threading.Lock()

    @property
    def computations(self) -> int:
        """The number of Argon2 evaluations so far, so tests can show every path costs the same."""
        return self._computations

    def _derive(self, password: str, salt: bytes, memory: int, iterations: int, parallelism: int, length: int) -> bytes:
        with self._slots:
            with self._count_lock:
                self._computations += 1
            return hash_secret_raw(
                normalize_password(password).encode("utf-8"), salt,
                time_cost=iterations, memory_cost=memory, parallelism=parallelism,
                hash_len=length, type=Type.ID, version=ARGON2_VERSION,
            )

    def hash(self, password: str) -> str:
        """A PHC string for `password`."""
        p = self._params
        salt = os.urandom(SALT_LENGTH)
        key = self._derive(password, salt, p.memory_kib, p.iterations, p.parallelism, KEY_LENGTH)
        return (
            f"$argon2id$v={ARGON2_VERSION}$m={p.memory_kib},t={p.iterations},p={p.parallelism}"
            f"${_b64(salt)}${_b64(key)}"
        )

    def verify(self, stored: str, password: str) -> bool:
        """Whether `password` matches the stored PHC string. A malformed hash is simply "no match"."""
        phc = _parse_phc(stored)
        if phc is None:
            return False
        key = self._derive(password, phc.salt, phc.memory, phc.iterations, phc.parallelism, len(phc.key))
        return hmac.compare_digest(key, phc.key)

    def verify_dummy(self, password: str) -> None:
        """Burns comparable work when there is no real hash to check, so response time does not
        reveal whether an account exists (AUTHN-LOGIN-003, AUTHN-REG-010)."""
        with self._dummy_lock:
            if self._dummy is None:
                self._dummy = self.hash("selfauth-dummy-password-for-timing")
            dummy = self._dummy
        self.verify(dummy, password)

    def needs_rehash(self, stored: str) -> bool:
        """True if the stored hash is weaker than the current configuration (SEC-HASH-004)."""
        phc = _parse_phc(stored)
        if phc is None:
            return True
        p = self._params
        return phc.memory < p.memory_kib or phc.iterations < p.iterations or phc.parallelism < p.parallelism


def check_password_policy(password: object, policy: Password, email: str) -> str:
    """Enforces SEC-PWPOLICY-001..006. Returns the password, or raises PASSWORD_POLICY_VIOLATION."""

    def violation(issue: str) -> errors.AuthError:
        return errors.AuthError(
            errors.PASSWORD_POLICY_VIOLATION,
            "Password does not meet the policy.",
            [{"field": "password", "issue": issue}],
        )

    if not isinstance(password, str):
        raise violation("required")
    normalized = normalize_password(password)
    length = len(normalized)
    if length < policy.min_length:
        raise violation(f"min_length_{policy.min_length}")
    if length > policy.max_length:
        raise violation(f"max_length_{policy.max_length}")
    lower = normalized.lower()
    if policy.reject_common and lower in COMMON_PASSWORDS:
        raise violation("too_common")
    if email and lower == email.lower():
        raise violation("equals_email")
    return password
