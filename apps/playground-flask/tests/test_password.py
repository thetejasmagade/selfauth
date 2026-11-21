from __future__ import annotations

from app.auth.password import PasswordHasher
from app.config import Hashing


def test_hashes_verify_and_are_salted() -> None:
    hasher = PasswordHasher(Hashing(memory_kib=64, iterations=1, parallelism=1))
    first, second = hasher.hash("correct horse battery staple"), hasher.hash("correct horse battery staple")
    assert first != second
    assert first.startswith("$argon2id$")
    assert hasher.verify(first, "correct horse battery staple")
    assert not hasher.verify(first, "another password entirely")
