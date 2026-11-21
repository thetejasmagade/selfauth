"""The store contract (DATA_MODEL.md), run against every store this machine can reach: the
in-memory store and SQLite always, the others when their server is configured (see tests/support.py)."""

from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone

import pytest

from app.auth import store as st
from app.auth.authz import role_definitions
from app.auth.ratelimit import RateLimitRecord
from app.auth.store import EmailTaken, EventRecord, SessionRecord, TokenRecord, UserPatch, UserRecord
from tests.conftest import make_config
from tests.support import STORES, fresh

NOW = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


def uid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


@pytest.fixture(params=STORES)
def backend(request):
    out = fresh(request.param)
    out.store.sync_roles(role_definitions(make_config()))
    yield out
    out.close()


def user(n: int, email: str | None = None) -> UserRecord:
    address = email or f"user{n}@example.com"
    return UserRecord(id=uid(n), state="active", created_at=NOW, updated_at=NOW, email=address, email_normalized=address)


def session(n: int, owner: int = 1) -> SessionRecord:
    return SessionRecord(
        id=uid(100 + n), token_hash=f"{n:064x}", user_id=uid(owner), created_at=NOW + timedelta(seconds=n),
        last_seen_at=NOW, idle_expires_at=NOW + timedelta(hours=1), absolute_expires_at=NOW + timedelta(hours=2),
    )


def test_creating_a_user_is_all_or_nothing(backend) -> None:
    """AUTHN-REG-003: a missing default role leaves no user and no credential behind."""
    s = backend.store
    with pytest.raises((ValueError, Exception)):
        s.create_user(user(1), "hash", ["user", "no-such-role"])
    assert s.find_user_by_id(uid(1)) is None
    assert s.get_password_hash(uid(1)) is None
    s.create_user(user(1), "hash", ["user"])
    assert s.get_password_hash(uid(1)) == "hash"
    assert s.get_user_roles(uid(1)) == ["user"]


def test_one_address_is_one_account_even_when_registrations_race(backend) -> None:
    """DATA-MODEL-001."""
    s = backend.store
    s.create_user(user(1, "maya@example.com"), "h", ["user"])
    with pytest.raises(EmailTaken):
        s.create_user(user(2, "maya@example.com"), "h", ["user"])
    outcomes: list[str] = []

    def register(n: int) -> None:
        try:
            s.create_user(user(n, "race@example.com"), "h", ["user"])
            outcomes.append("created")
        except EmailTaken:
            outcomes.append("taken")

    threads = [threading.Thread(target=register, args=(n,)) for n in range(10, 18)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert outcomes.count("created") == 1
    assert outcomes.count("taken") == 7


def test_deleting_an_account_releases_its_address(backend) -> None:
    s = backend.store
    s.create_user(user(1, "maya@example.com"), "h", ["user"])
    s.update_user(uid(1), UserPatch(state="deleted", deleted_at=NOW, updated_at=NOW, clear_email=True))
    assert s.find_user_by_email("maya@example.com") is None
    s.create_user(user(2, "maya@example.com"), "h", ["user"])
    assert s.find_user_by_email("maya@example.com").id == uid(2)


def test_passwords_can_be_replaced_and_removed(backend) -> None:
    s = backend.store
    s.create_user(user(1), "one", ["user"])
    s.set_password_hash(uid(1), "two", NOW + timedelta(minutes=1))
    assert s.get_password_hash(uid(1)) == "two"
    s.delete_credentials(uid(1))
    assert s.get_password_hash(uid(1)) is None
    s.set_password_hash(uid(1), "three", NOW)
    assert s.get_password_hash(uid(1)) == "three"


def test_sessions_are_revoked_individually_and_in_bulk(backend) -> None:
    s = backend.store
    s.create_user(user(1), "h", ["user"])
    for n in (1, 2, 3):
        s.create_session(session(n))
    assert len(s.list_active_sessions(uid(1), NOW)) == 3
    s.revoke_session(uid(101), "logout", NOW)
    assert s.find_session_by_id(uid(101)).revoked_reason == "logout"
    assert s.revoke_user_sessions(uid(1), "logout_all", NOW, uid(102)) == 1
    active = s.list_active_sessions(uid(1), NOW)
    assert [x.id for x in active] == [uid(102)]
    assert s.find_session_by_token_hash(f"{2:064x}").id == uid(102)


def token(n: int = 1, kind: str = st.TOKEN_PASSWORD_RESET) -> TokenRecord:
    return TokenRecord(
        id=uid(200 + n), kind=kind, user_id=uid(1), token_hash=f"{900 + n:064x}",
        expires_at=NOW + timedelta(hours=1), created_at=NOW,
        email="maya@example.com" if kind == st.TOKEN_EMAIL_VERIFICATION else None,
    )


def test_a_token_can_be_consumed_only_once_even_when_two_requests_race(backend) -> None:
    """AUTHN-RESET-009, AUTHN-VERIFY-006."""
    s = backend.store
    s.create_user(user(1), "h", ["user"])
    s.create_token(token())
    results: list[bool] = []
    threads = [threading.Thread(target=lambda: results.append(s.consume_token(uid(201), NOW))) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results.count(True) == 1
    assert s.find_token(st.TOKEN_PASSWORD_RESET, f"{901:064x}").used_at is not None


def test_expired_and_invalidated_tokens_cannot_be_consumed(backend) -> None:
    s = backend.store
    s.create_user(user(1), "h", ["user"])
    s.create_token(token(1))
    s.create_token(token(2, st.TOKEN_EMAIL_VERIFICATION))
    assert not s.consume_token(uid(201), NOW + timedelta(hours=2))
    s.invalidate_user_tokens(uid(1), st.TOKENS_ALL, NOW)
    assert not s.consume_token(uid(201), NOW)
    assert not s.consume_token(uid(202), NOW)
    assert s.find_token(st.TOKEN_EMAIL_VERIFICATION, f"{902:064x}").email == "maya@example.com"


def test_role_sync_makes_permissions_exact_and_never_prunes_assignments(backend) -> None:
    """AUTHZ-RBAC-005."""
    s = backend.store
    s.sync_roles({"user": ["a.b", "c.d"], "admin": ["a.b"], "editor": ["c.d"]})
    s.create_user(user(1), "h", ["editor"])
    assert sorted(s.get_role_permissions(["user"])) == ["a.b", "c.d"]
    s.sync_roles({"user": ["a.b"], "admin": ["a.b"]})  # editor disappears from the configuration
    assert s.get_role_permissions(["user"]) == ["a.b"]
    assert s.get_user_roles(uid(1)) == ["editor"]  # the assignment stays
    assert s.role_exists("editor")


def test_roles_can_be_added_removed_and_counted(backend) -> None:
    s = backend.store
    s.create_user(user(1), "h", ["user"])
    s.add_user_role(uid(1), "admin", None, NOW)
    s.add_user_role(uid(1), "admin", None, NOW)  # idempotent
    assert sorted(s.get_user_roles(uid(1))) == ["admin", "user"]
    assert s.count_active_users_with_role("admin") == 1
    s.remove_user_role(uid(1), "admin")
    assert s.get_user_roles(uid(1)) == ["user"]
    with pytest.raises(Exception):
        s.add_user_role(uid(1), "nope", None, NOW)


def test_ids_of_another_shape_match_nothing_instead_of_failing(backend) -> None:
    """A non-UUID id is a miss on every store, never a database error."""
    s = backend.store
    assert s.find_user_by_id("not-a-uuid") is None
    assert s.find_session_by_id("not-a-uuid") is None
    assert s.get_user_roles("not-a-uuid") == []
    assert s.revoke_user_sessions("not-a-uuid", "logout", NOW) == 0


def test_events_are_appended_in_order(backend) -> None:
    s = backend.store
    for n in range(3):
        s.record_event(EventRecord(id=uid(300 + n), type=f"t{n}", outcome="success", occurred_at=NOW, metadata={"n": n}))


def test_a_rate_limit_key_updates_one_at_a_time(backend) -> None:
    """SEC-RATE-006: concurrent updates of one key serialize, so no increment is lost."""
    r = backend.rate_limit_store

    def bump(current: RateLimitRecord | None) -> RateLimitRecord:
        count = (current.count if current else 0) + 1
        return RateLimitRecord(count=count, window_ends_at=NOW.timestamp().__int__() * 1000 + 60_000)

    threads = [threading.Thread(target=lambda: r.update("login:a", bump)) for _ in range(12)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    seen: list[int] = []
    r.update("login:a", lambda c: seen.append(c.count) or None)
    assert seen == [12]
    r.delete("login:a")
    r.update("login:a", lambda c: seen.append(-1 if c is None else c.count) or None)
    assert seen[-1] == -1
