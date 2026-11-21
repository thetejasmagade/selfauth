"""The persistence contract of the core (DATA_MODEL.md).

Methods documented as atomic MUST be atomic in the database (DATA-MODEL-002).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

# Account states.
PENDING, ACTIVE, SUSPENDED, DISABLED, DELETED = "pending", "active", "suspended", "disabled", "deleted"

# Why a session ended.
REVOKED_LOGOUT = "logout"
REVOKED_LOGOUT_ALL = "logout_all"
REVOKED_PASSWORD_CHANGED = "password_changed"
REVOKED_PASSWORD_RESET = "password_reset"
REVOKED_STATE_CHANGED = "state_changed"
REVOKED_ADMIN = "admin"
REVOKED_ROTATED = "rotated"

# One-time token kinds.
TOKEN_PASSWORD_RESET = "passwordReset"
TOKEN_EMAIL_VERIFICATION = "emailVerification"
TOKENS_ALL = "all"


@dataclass
class UserRecord:
    id: str
    state: str
    created_at: datetime
    updated_at: datetime
    email: str | None = None
    email_normalized: str | None = None
    email_verified_at: datetime | None = None
    deleted_at: datetime | None = None


@dataclass
class UserPatch:
    """Changes only the fields that are set (not None)."""

    state: str | None = None
    email_verified_at: datetime | None = None
    updated_at: datetime | None = None
    deleted_at: datetime | None = None
    # Removes the address (account deletion releases it).
    clear_email: bool = False


@dataclass
class SessionRecord:
    id: str
    token_hash: str
    user_id: str
    created_at: datetime
    last_seen_at: datetime
    idle_expires_at: datetime
    absolute_expires_at: datetime
    revoked_at: datetime | None = None
    revoked_reason: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    reauthenticated_at: datetime | None = None


@dataclass
class TokenRecord:
    id: str
    kind: str
    user_id: str
    token_hash: str
    expires_at: datetime
    created_at: datetime
    # Email verification only: the normalized address the token was issued for.
    email: str | None = None
    used_at: datetime | None = None
    invalidated_at: datetime | None = None


@dataclass
class EventRecord:
    id: str
    type: str
    outcome: str  # "success" or "failure"
    occurred_at: datetime
    user_id: str | None = None
    actor_id: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    request_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class EmailTaken(Exception):
    """Raised by `create_user` when the normalized email is already taken (DATA-MODEL-001)."""


class Store(ABC):
    """The persistence contract of the core."""

    @abstractmethod
    def create_user(self, user: UserRecord, password_hash: str, roles: list[str]) -> UserRecord:
        """Atomic: creates the user, password credential and role links, or nothing (AUTHN-REG-003)."""

    @abstractmethod
    def find_user_by_id(self, user_id: str) -> UserRecord | None: ...

    @abstractmethod
    def find_user_by_email(self, email_normalized: str) -> UserRecord | None:
        """The non-deleted user with this normalized email."""

    @abstractmethod
    def update_user(self, user_id: str, patch: UserPatch) -> None: ...

    @abstractmethod
    def get_password_hash(self, user_id: str) -> str | None: ...

    @abstractmethod
    def set_password_hash(self, user_id: str, password_hash: str, at: datetime) -> None: ...

    @abstractmethod
    def delete_credentials(self, user_id: str) -> None: ...

    @abstractmethod
    def create_session(self, session: SessionRecord) -> None: ...

    @abstractmethod
    def find_session_by_token_hash(self, token_hash: str) -> SessionRecord | None: ...

    @abstractmethod
    def find_session_by_id(self, session_id: str) -> SessionRecord | None: ...

    @abstractmethod
    def touch_session(self, session_id: str, last_seen_at: datetime, idle_expires_at: datetime) -> None: ...

    @abstractmethod
    def revoke_session(self, session_id: str, reason: str, at: datetime) -> None: ...

    @abstractmethod
    def revoke_user_sessions(self, user_id: str, reason: str, at: datetime, except_session_id: str | None = None) -> int:
        """Revokes all of the user's active sessions, optionally keeping one, and returns the count."""

    @abstractmethod
    def list_active_sessions(self, user_id: str, now: datetime) -> list[SessionRecord]: ...

    @abstractmethod
    def create_token(self, token: TokenRecord) -> None: ...

    @abstractmethod
    def find_token(self, kind: str, token_hash: str) -> TokenRecord | None: ...

    @abstractmethod
    def consume_token(self, token_id: str, now: datetime) -> bool:
        """An atomic conditional consume: succeeds only if the token is unused, not invalidated and
        unexpired."""

    @abstractmethod
    def invalidate_user_tokens(self, user_id: str, kind: str, at: datetime) -> None: ...

    @abstractmethod
    def sync_roles(self, roles: dict[str, list[str]]) -> None:
        """The explicit role synchronization (AUTHZ-RBAC-005)."""

    @abstractmethod
    def get_user_roles(self, user_id: str) -> list[str]: ...

    @abstractmethod
    def get_role_permissions(self, roles: list[str]) -> list[str]: ...

    @abstractmethod
    def role_exists(self, role: str) -> bool: ...

    @abstractmethod
    def add_user_role(self, user_id: str, role: str, assigned_by: str | None, at: datetime) -> None: ...

    @abstractmethod
    def remove_user_role(self, user_id: str, role: str) -> None: ...

    @abstractmethod
    def count_active_users_with_role(self, role: str) -> int: ...

    @abstractmethod
    def record_event(self, event: EventRecord) -> None:
        """Append-only (SEC-AUDIT-004)."""
