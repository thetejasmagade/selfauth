"""The core's timing and token rules, checked without a database."""

from __future__ import annotations

from tests.conftest import Harness, make_config

PASSWORD = "correct horse battery staple"


def computations(h: Harness) -> int:
    return h.auth.service.d.hasher.computations


def test_login_costs_the_same_for_an_unknown_account_and_a_wrong_password(harness: Harness) -> None:
    """AUTHN-LOGIN-003: a login for an account that does not exist runs exactly as many Argon2
    evaluations as a login with a wrong password, so timing does not reveal accounts."""
    harness.post("/auth/register", {"email": "maya@example.com", "password": PASSWORD})
    harness.client.delete_cookie(harness.config.authentication.sessions.cookie.name)
    before = computations(harness)
    harness.post("/auth/login", {"email": "maya@example.com", "password": "not the password at all"})
    wrong = computations(harness) - before
    before = computations(harness)
    harness.post("/auth/login", {"email": "nobody@example.com", "password": "not the password at all"})
    unknown = computations(harness) - before
    assert wrong == unknown >= 1


def test_registering_an_existing_address_costs_the_same_as_a_new_one(harness: Harness) -> None:
    """AUTHN-REG-010: every path through register hashes the password once."""
    before = computations(harness)
    harness.post("/auth/register", {"email": "maya@example.com", "password": PASSWORD})
    fresh = computations(harness) - before
    harness.client.delete_cookie(harness.config.authentication.sessions.cookie.name)
    before = computations(harness)
    harness.post("/auth/register", {"email": "maya@example.com", "password": PASSWORD})
    existing = computations(harness) - before
    assert fresh == existing >= 1


def test_the_verification_link_carries_the_token_in_the_fragment() -> None:
    """SEC-TOKEN-005: a token in the query string would reach logs and Referer headers."""
    h = Harness(make_config(lambda c: setattr(c.authentication.email_verification, "mode", "required")
                            or setattr(c.authentication.registration, "sign_in_after_registration", False)))
    h.post("/auth/register", {"email": "maya@example.com", "password": PASSWORD})
    link = h.mailer.sent[-1].link
    assert "#token=" in link
    assert "?" not in link
    assert link.startswith("https://app.example.test/")


def test_responses_send_a_no_referrer_policy(harness: Harness) -> None:
    response = harness.client.get("/auth/me")
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Cache-Control"] == "no-store"


def test_concurrent_hashes_are_bounded() -> None:
    """SEC-HASH-006: a burst of requests cannot exhaust memory with parallel Argon2 runs."""
    import threading

    from app.auth.password import PasswordHasher
    from app.config import Hashing

    hasher = PasswordHasher(Hashing(memory_kib=64, iterations=1, parallelism=1))
    slots = hasher._slots  # noqa: SLF001 - the bound is the point of the test
    held = [slots.acquire(blocking=False) for _ in range(1000)]
    acquired = sum(held)
    for _ in range(acquired):
        slots.release()
    assert 2 <= acquired < 1000
    done = threading.Event()
    threading.Thread(target=lambda: (hasher.hash("x" * 12), done.set())).start()
    assert done.wait(10)
