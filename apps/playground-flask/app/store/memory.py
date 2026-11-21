"""The in-memory store: for trying SelfAuth out and for tests. Data is lost on restart and is not
shared between processes."""

from __future__ import annotations

import threading
from copy import copy
from dataclasses import dataclass
from datetime import datetime
from typing import Callable

from ..auth import errors  # noqa: F401  (keeps the import graph explicit)
from ..auth import store as st
from ..auth.store import EmailTaken, EventRecord, SessionRecord, Store, TokenRecord, UserPatch, UserRecord


@dataclass
class Credential:
    id: str
    user_id: str
    type: str
    secret_hash: str
    created_at: datetime
    updated_at: datetime


@dataclass
class UserRole:
    user_id: str
    role: str
    assigned_at: datetime
    assigned_by: str | None = None


class MemoryStore(Store):
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.users: dict[str, UserRecord] = {}
        self.credentials: dict[str, Credential] = {}
        self.sessions: dict[str, SessionRecord] = {}
        self.tokens: dict[str, TokenRecord] = {}
        self.roles: dict[str, list[str]] = {}
        self.user_roles: list[UserRole] = []
        self.events: list[EventRecord] = []
        self._cred_seq = 0

    # users
    def create_user(self, user: UserRecord, password_hash: str, roles: list[str]) -> UserRecord:
        with self._lock:
            if user.email_normalized is not None:
                for existing in self.users.values():
                    if existing.email_normalized == user.email_normalized:
                        raise EmailTaken()  # unique among non-deleted users (IDENT-EMAIL-003)
            for role in roles:
                if role not in self.roles:
                    raise ValueError(f"default role {role!r} is not synchronized")
            self.users[user.id] = copy(user)
            self._cred_seq += 1
            self.credentials[user.id] = Credential(
                f"cred-{self._cred_seq}", user.id, "password", password_hash, user.created_at, user.created_at
            )
            for role in roles:
                self.user_roles.append(UserRole(user.id, role, user.created_at))
            return copy(user)

    def find_user_by_id(self, user_id: str) -> UserRecord | None:
        with self._lock:
            user = self.users.get(user_id)
            return copy(user) if user else None

    def find_user_by_email(self, email_normalized: str) -> UserRecord | None:
        with self._lock:
            for user in self.users.values():
                if user.email_normalized == email_normalized and user.state != st.DELETED:
                    return copy(user)
            return None

    def update_user(self, user_id: str, patch: UserPatch) -> None:
        with self._lock:
            user = self.users.get(user_id)
            if user is None:
                return
            if patch.state is not None:
                user.state = patch.state
            if patch.email_verified_at is not None:
                user.email_verified_at = patch.email_verified_at
            if patch.updated_at is not None:
                user.updated_at = patch.updated_at
            if patch.deleted_at is not None:
                user.deleted_at = patch.deleted_at
            if patch.clear_email:
                user.email = user.email_normalized = None

    # credentials
    def get_password_hash(self, user_id: str) -> str | None:
        with self._lock:
            credential = self.credentials.get(user_id)
            return credential.secret_hash if credential else None

    def set_password_hash(self, user_id: str, password_hash: str, at: datetime) -> None:
        with self._lock:
            credential = self.credentials.get(user_id)
            if credential is None:
                self._cred_seq += 1
                credential = Credential(f"cred-{self._cred_seq}", user_id, "password", "", at, at)
                self.credentials[user_id] = credential
            credential.secret_hash, credential.updated_at = password_hash, at

    def delete_credentials(self, user_id: str) -> None:
        with self._lock:
            self.credentials.pop(user_id, None)

    # sessions
    def create_session(self, session: SessionRecord) -> None:
        with self._lock:
            self.sessions[session.id] = copy(session)

    def find_session_by_token_hash(self, token_hash: str) -> SessionRecord | None:
        with self._lock:
            for session in self.sessions.values():
                if session.token_hash == token_hash:
                    return copy(session)
            return None

    def find_session_by_id(self, session_id: str) -> SessionRecord | None:
        with self._lock:
            session = self.sessions.get(session_id)
            return copy(session) if session else None

    def touch_session(self, session_id: str, last_seen_at: datetime, idle_expires_at: datetime) -> None:
        with self._lock:
            session = self.sessions.get(session_id)
            if session is not None and session.revoked_at is None:
                session.last_seen_at, session.idle_expires_at = last_seen_at, idle_expires_at

    def revoke_session(self, session_id: str, reason: str, at: datetime) -> None:
        with self._lock:
            session = self.sessions.get(session_id)
            if session is not None and session.revoked_at is None:
                session.revoked_at, session.revoked_reason = at, reason

    def revoke_user_sessions(self, user_id: str, reason: str, at: datetime, except_session_id: str | None = None) -> int:
        with self._lock:
            count = 0
            for session in self.sessions.values():
                if session.user_id == user_id and session.revoked_at is None and session.id != except_session_id:
                    session.revoked_at, session.revoked_reason = at, reason
                    count += 1
            return count

    def list_active_sessions(self, user_id: str, now: datetime) -> list[SessionRecord]:
        with self._lock:
            return [
                copy(s) for s in self.sessions.values()
                if s.user_id == user_id and s.revoked_at is None and now < s.idle_expires_at and now < s.absolute_expires_at
            ]

    # tokens
    def create_token(self, token: TokenRecord) -> None:
        with self._lock:
            self.tokens[token.id] = copy(token)

    def find_token(self, kind: str, token_hash: str) -> TokenRecord | None:
        with self._lock:
            for token in self.tokens.values():
                if token.kind == kind and token.token_hash == token_hash:
                    return copy(token)
            return None

    def consume_token(self, token_id: str, now: datetime) -> bool:
        with self._lock:
            token = self.tokens.get(token_id)
            if token is None or token.used_at is not None or token.invalidated_at is not None or now >= token.expires_at:
                return False
            token.used_at = now
            return True

    def invalidate_user_tokens(self, user_id: str, kind: str, at: datetime) -> None:
        with self._lock:
            for token in self.tokens.values():
                if (
                    token.user_id == user_id and (kind == st.TOKENS_ALL or token.kind == kind)
                    and token.used_at is None and token.invalidated_at is None
                ):
                    token.invalidated_at = at

    # roles
    def sync_roles(self, roles: dict[str, list[str]]) -> None:
        with self._lock:
            self.roles = {name: list(perms) for name, perms in roles.items()}

    def get_user_roles(self, user_id: str) -> list[str]:
        with self._lock:
            return [r.role for r in self.user_roles if r.user_id == user_id]

    def get_role_permissions(self, roles: list[str]) -> list[str]:
        with self._lock:
            seen: dict[str, None] = {}
            for role in roles:
                for permission in self.roles.get(role, []):
                    seen.setdefault(permission)
            return list(seen)

    def role_exists(self, role: str) -> bool:
        with self._lock:
            return role in self.roles

    def add_user_role(self, user_id: str, role: str, assigned_by: str | None, at: datetime) -> None:
        with self._lock:
            if role not in self.roles:
                raise ValueError(f"role {role!r} does not exist")
            if any(r.user_id == user_id and r.role == role for r in self.user_roles):
                return
            self.user_roles.append(UserRole(user_id, role, at, assigned_by))

    def remove_user_role(self, user_id: str, role: str) -> None:
        with self._lock:
            self.user_roles = [r for r in self.user_roles if not (r.user_id == user_id and r.role == role)]

    def count_active_users_with_role(self, role: str) -> int:
        with self._lock:
            return sum(
                1 for r in self.user_roles
                if r.role == role and (u := self.users.get(r.user_id)) is not None and u.state == st.ACTIVE
            )

    # events
    def record_event(self, event: EventRecord) -> None:
        with self._lock:
            self.events.append(event)

    # test and harness helpers
    def mutate_users(self, match: Callable[[UserRecord], bool], change: Callable[[UserRecord], None]) -> None:
        with self._lock:
            for user in self.users.values():
                if match(user):
                    change(user)
