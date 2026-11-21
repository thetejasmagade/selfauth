"""The auth store for PostgreSQL, MySQL and SQLite. The schema is the migration in db/migrations
(the PostgreSQL reference, with MySQL and SQLite derived from it), so the tables and their names are
the same on every database.

Atomicity (DATA-MODEL-002): user creation runs in one transaction, token consumption and session
revocation are conditional updates, and rate-limit updates serialize per key (a row lock on
PostgreSQL and MySQL; SQLite takes the write lock when a transaction starts).
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Callable

from ..auth import store as st
from ..auth.clock import from_millis, millis
from ..auth.crypto import new_id
from ..auth.ratelimit import RateLimitRecord
from ..auth.store import EmailTaken, EventRecord, SessionRecord, Store, TokenRecord, UserPatch, UserRecord
from .dialect import Database, Tx

_USER_COLUMNS = "id, email, email_normalized, email_verified_at, state, created_at, updated_at, deleted_at"
_SESSION_COLUMNS = (
    "id, token_hash, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, "
    "revoked_at, revoked_reason, ip_address, user_agent, reauthenticated_at"
)


_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


def _marks(n: int) -> str:
    return ",".join("?" * n)


class SqlStore(Store):
    def __init__(self, db: Database) -> None:
        self.db = db
        self.d = db.dialect

    def _bad_id(self, *ids: str | None) -> bool:
        """PostgreSQL id columns are uuid and raise for any other text, so an id of another shape
        simply matches nothing (the same answer the other databases give)."""
        return self.d.kind == "postgresql" and any(i and not _UUID.match(i) for i in ids)

    # ── users ──

    def _user(self, row: tuple | None) -> UserRecord | None:
        if row is None:
            return None
        d = self.d
        return UserRecord(
            id=d.to_id(row[0]),  # type: ignore[arg-type]
            email=row[1],
            email_normalized=row[2],
            email_verified_at=d.read_time(row[3]),
            state=row[4],
            created_at=d.read_time(row[5]),  # type: ignore[arg-type]
            updated_at=d.read_time(row[6]),  # type: ignore[arg-type]
            deleted_at=d.read_time(row[7]),
        )

    def create_user(self, user: UserRecord, password_hash: str, roles: list[str]) -> UserRecord:
        d = self.d
        try:
            # All-or-nothing: user, password credential and default roles (AUTHN-REG-003).
            with self.db.transaction() as tx:
                role_ids: list[str] = []
                if roles:
                    rows = tx.query(f"SELECT id FROM auth_roles WHERE name IN ({_marks(len(roles))})", list(roles))
                    role_ids = [d.to_id(r[0]) for r in rows]  # type: ignore[misc]
                if len(role_ids) != len(set(roles)):
                    raise ValueError(f"default roles are not synchronized: {', '.join(roles)}")
                tx.execute(
                    "INSERT INTO auth_users (id, email, email_normalized, email_verified_at, state, created_at, "
                    "updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        user.id, user.email, user.email_normalized, d.t(user.email_verified_at), user.state,
                        d.t(user.created_at), d.t(user.updated_at), d.t(user.deleted_at),
                    ],
                )
                tx.execute(
                    "INSERT INTO auth_credentials (id, user_id, type, secret_hash, created_at, updated_at) "
                    "VALUES (?, ?, 'password', ?, ?, ?)",
                    [new_id(), user.id, password_hash, d.t(user.created_at), d.t(user.created_at)],
                )
                for role_id in role_ids:
                    tx.execute(
                        "INSERT INTO auth_user_roles (user_id, role_id, assigned_at) VALUES (?, ?, ?)",
                        [user.id, role_id, d.t(user.created_at)],
                    )
        except Exception as error:
            if d.is_duplicate(error, "email_normalized"):
                raise EmailTaken() from None
            raise
        return user

    def find_user_by_id(self, user_id: str) -> UserRecord | None:
        if self._bad_id(user_id):
            return None
        return self._user(self.db.query_one(f"SELECT {_USER_COLUMNS} FROM auth_users WHERE id = ?", [user_id]))

    def find_user_by_email(self, email_normalized: str) -> UserRecord | None:
        return self._user(
            self.db.query_one(
                f"SELECT {_USER_COLUMNS} FROM auth_users WHERE email_normalized = ? AND state <> 'deleted' LIMIT 1",
                [email_normalized],
            )
        )

    def update_user(self, user_id: str, patch: UserPatch) -> None:
        if self._bad_id(user_id):
            return
        d = self.d
        sets: list[str] = []
        args: list[Any] = []

        def put(column: str, value: Any) -> None:
            sets.append(f"{column} = ?")
            args.append(value)

        if patch.state is not None:
            put("state", patch.state)
        if patch.email_verified_at is not None:
            put("email_verified_at", d.t(patch.email_verified_at))
        if patch.updated_at is not None:
            put("updated_at", d.t(patch.updated_at))
        if patch.deleted_at is not None:
            put("deleted_at", d.t(patch.deleted_at))
        if patch.clear_email:
            sets += ["email = NULL", "email_normalized = NULL"]
        if not sets:
            return
        args.append(user_id)
        self.db.execute(f"UPDATE auth_users SET {', '.join(sets)} WHERE id = ?", args)

    # ── credentials ──

    def get_password_hash(self, user_id: str) -> str | None:
        if self._bad_id(user_id):
            return None
        row = self.db.query_one(
            "SELECT secret_hash FROM auth_credentials WHERE user_id = ? AND type = 'password'", [user_id]
        )
        return None if row is None else row[0]

    def set_password_hash(self, user_id: str, password_hash: str, at: datetime) -> None:
        if self._bad_id(user_id):
            return
        self.db.execute(
            "INSERT INTO auth_credentials (id, user_id, type, secret_hash, created_at, updated_at) "
            f"VALUES (?, ?, 'password', ?, ?, ?) {self.d.upsert_credential}",
            [new_id(), user_id, password_hash, self.d.t(at), self.d.t(at)],
        )

    def delete_credentials(self, user_id: str) -> None:
        if self._bad_id(user_id):
            return
        self.db.execute("DELETE FROM auth_credentials WHERE user_id = ?", [user_id])

    # ── sessions ──

    def _session(self, row: tuple | None) -> SessionRecord | None:
        if row is None:
            return None
        d = self.d
        return SessionRecord(
            id=d.to_id(row[0]),  # type: ignore[arg-type]
            token_hash=(row[1] or "").strip(),
            user_id=d.to_id(row[2]),  # type: ignore[arg-type]
            created_at=d.read_time(row[3]),  # type: ignore[arg-type]
            last_seen_at=d.read_time(row[4]),  # type: ignore[arg-type]
            idle_expires_at=d.read_time(row[5]),  # type: ignore[arg-type]
            absolute_expires_at=d.read_time(row[6]),  # type: ignore[arg-type]
            revoked_at=d.read_time(row[7]),
            revoked_reason=row[8],
            ip_address=row[9],
            user_agent=row[10],
            reauthenticated_at=d.read_time(row[11]),
        )

    def create_session(self, session: SessionRecord) -> None:
        d = self.d
        self.db.execute(
            "INSERT INTO auth_sessions (id, token_hash, user_id, created_at, last_seen_at, idle_expires_at, "
            "absolute_expires_at, revoked_at, revoked_reason, ip_address, user_agent, reauthenticated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)",
            [
                session.id, session.token_hash, session.user_id, d.t(session.created_at), d.t(session.last_seen_at),
                d.t(session.idle_expires_at), d.t(session.absolute_expires_at), session.ip_address,
                session.user_agent, d.t(session.reauthenticated_at),
            ],
        )

    def find_session_by_token_hash(self, token_hash: str) -> SessionRecord | None:
        return self._session(
            self.db.query_one(f"SELECT {_SESSION_COLUMNS} FROM auth_sessions WHERE token_hash = ?", [token_hash])
        )

    def find_session_by_id(self, session_id: str) -> SessionRecord | None:
        if self._bad_id(session_id):
            return None
        return self._session(
            self.db.query_one(f"SELECT {_SESSION_COLUMNS} FROM auth_sessions WHERE id = ?", [session_id])
        )

    def touch_session(self, session_id: str, last_seen_at: datetime, idle_expires_at: datetime) -> None:
        if self._bad_id(session_id):
            return
        self.db.execute(
            "UPDATE auth_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ? AND revoked_at IS NULL",
            [self.d.t(last_seen_at), self.d.t(idle_expires_at), session_id],
        )

    def revoke_session(self, session_id: str, reason: str, at: datetime) -> None:
        if self._bad_id(session_id):
            return
        self.db.execute(
            "UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL",
            [self.d.t(at), reason, session_id],
        )

    def revoke_user_sessions(
        self, user_id: str, reason: str, at: datetime, except_session_id: str | None = None
    ) -> int:
        if self._bad_id(user_id, except_session_id):
            return 0
        sql = "UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL"
        args: list[Any] = [self.d.t(at), reason, user_id]
        if except_session_id:
            sql += " AND id <> ?"
            args.append(except_session_id)
        return self.db.execute(sql, args)

    def list_active_sessions(self, user_id: str, now: datetime) -> list[SessionRecord]:
        if self._bad_id(user_id):
            return []
        rows = self.db.query(
            f"SELECT {_SESSION_COLUMNS} FROM auth_sessions "
            "WHERE user_id = ? AND revoked_at IS NULL AND idle_expires_at > ? AND absolute_expires_at > ? "
            "ORDER BY created_at ASC",
            [user_id, self.d.t(now), self.d.t(now)],
        )
        return [self._session(r) for r in rows]  # type: ignore[misc]

    # ── one-time tokens (two tables, one logical contract) ──

    @staticmethod
    def _token_table(kind: str) -> str:
        return "auth_password_reset_tokens" if kind == st.TOKEN_PASSWORD_RESET else "auth_email_verification_tokens"

    def create_token(self, token: TokenRecord) -> None:
        d = self.d
        if token.kind == st.TOKEN_PASSWORD_RESET:
            self.db.execute(
                "INSERT INTO auth_password_reset_tokens (id, user_id, token_hash, expires_at, used_at, "
                "invalidated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    token.id, token.user_id, token.token_hash, d.t(token.expires_at), d.t(token.used_at),
                    d.t(token.invalidated_at), d.t(token.created_at),
                ],
            )
            return
        self.db.execute(
            "INSERT INTO auth_email_verification_tokens (id, user_id, token_hash, email, expires_at, used_at, "
            "invalidated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                token.id, token.user_id, token.token_hash, token.email or "", d.t(token.expires_at),
                d.t(token.used_at), d.t(token.invalidated_at), d.t(token.created_at),
            ],
        )

    def find_token(self, kind: str, token_hash: str) -> TokenRecord | None:
        d = self.d
        if kind == st.TOKEN_PASSWORD_RESET:
            row = self.db.query_one(
                "SELECT id, user_id, token_hash, expires_at, used_at, invalidated_at, created_at "
                "FROM auth_password_reset_tokens WHERE token_hash = ?",
                [token_hash],
            )
            if row is None:
                return None
            return TokenRecord(
                id=d.to_id(row[0]), kind=kind, user_id=d.to_id(row[1]), token_hash=row[2].strip(),  # type: ignore[arg-type]
                expires_at=d.read_time(row[3]), used_at=d.read_time(row[4]),  # type: ignore[arg-type]
                invalidated_at=d.read_time(row[5]), created_at=d.read_time(row[6]),  # type: ignore[arg-type]
            )
        row = self.db.query_one(
            "SELECT id, user_id, token_hash, email, expires_at, used_at, invalidated_at, created_at "
            "FROM auth_email_verification_tokens WHERE token_hash = ?",
            [token_hash],
        )
        if row is None:
            return None
        return TokenRecord(
            id=d.to_id(row[0]), kind=kind, user_id=d.to_id(row[1]), token_hash=row[2].strip(), email=row[3],  # type: ignore[arg-type]
            expires_at=d.read_time(row[4]), used_at=d.read_time(row[5]),  # type: ignore[arg-type]
            invalidated_at=d.read_time(row[6]), created_at=d.read_time(row[7]),  # type: ignore[arg-type]
        )

    def consume_token(self, token_id: str, now: datetime) -> bool:
        if self._bad_id(token_id):
            return False
        # A conditional update: at most one concurrent caller succeeds (AUTHN-RESET-009, AUTHN-VERIFY-006).
        for table in ("auth_password_reset_tokens", "auth_email_verification_tokens"):
            changed = self.db.execute(
                f"UPDATE {table} SET used_at = ? "
                "WHERE id = ? AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > ?",
                [self.d.t(now), token_id, self.d.t(now)],
            )
            if changed == 1:
                return True
        return False

    def invalidate_user_tokens(self, user_id: str, kind: str, at: datetime) -> None:
        if self._bad_id(user_id):
            return
        kinds = [st.TOKEN_PASSWORD_RESET, st.TOKEN_EMAIL_VERIFICATION] if kind == st.TOKENS_ALL else [kind]
        for k in kinds:
            self.db.execute(
                f"UPDATE {self._token_table(k)} SET invalidated_at = ? "
                "WHERE user_id = ? AND used_at IS NULL AND invalidated_at IS NULL",
                [self.d.t(at), user_id],
            )

    # ── roles ──

    def sync_roles(self, roles: dict[str, list[str]]) -> None:
        """Upserts configured roles and permissions and makes each configured role's permissions
        exact. Roles and permissions no longer in configuration are kept (deleting them would
        silently strip users' roles); remove them with a reviewed migration (AUTHZ-RBAC-005)."""
        d = self.d
        with self.db.transaction() as tx:
            for permissions in roles.values():
                for name in permissions:
                    tx.execute(d.insert_ignore("auth_permissions (id, name) VALUES (?, ?)"), [new_id(), name])
            for name, permissions in roles.items():
                system = name in ("admin", "user")
                tx.execute(
                    f"INSERT INTO auth_roles (id, name, is_system) VALUES (?, ?, ?) {d.upsert_role}",
                    [new_id(), name, system],
                )
                row = tx.query_one("SELECT id FROM auth_roles WHERE name = ?", [name])
                role_id = d.to_id(row[0])  # type: ignore[index]
                if not permissions:
                    tx.execute("DELETE FROM auth_role_permissions WHERE role_id = ?", [role_id])
                    continue
                marks = _marks(len(permissions))
                tx.execute(
                    "DELETE FROM auth_role_permissions WHERE role_id = ? AND permission_id NOT IN "
                    f"(SELECT id FROM auth_permissions WHERE name IN ({marks}))",
                    [role_id, *permissions],
                )
                for permission in tx.query(
                    f"SELECT id FROM auth_permissions WHERE name IN ({marks})", list(permissions)
                ):
                    tx.execute(
                        d.insert_ignore("auth_role_permissions (role_id, permission_id) VALUES (?, ?)"),
                        [role_id, d.to_id(permission[0])],
                    )

    def get_user_roles(self, user_id: str) -> list[str]:
        if self._bad_id(user_id):
            return []
        rows = self.db.query(
            "SELECT r.name FROM auth_user_roles ur JOIN auth_roles r ON r.id = ur.role_id WHERE ur.user_id = ?",
            [user_id],
        )
        return [r[0] for r in rows]

    def get_role_permissions(self, roles: list[str]) -> list[str]:
        if not roles:
            return []
        rows = self.db.query(
            "SELECT DISTINCT p.name FROM auth_role_permissions rp "
            "JOIN auth_roles r ON r.id = rp.role_id JOIN auth_permissions p ON p.id = rp.permission_id "
            f"WHERE r.name IN ({_marks(len(roles))})",
            list(roles),
        )
        return [r[0] for r in rows]

    def role_exists(self, role: str) -> bool:
        return self.db.query_one("SELECT COUNT(*) FROM auth_roles WHERE name = ?", [role])[0] > 0  # type: ignore[index]

    def add_user_role(self, user_id: str, role: str, assigned_by: str | None, at: datetime) -> None:
        if self._bad_id(user_id, assigned_by):
            return
        row = self.db.query_one("SELECT id FROM auth_roles WHERE name = ?", [role])
        if row is None:
            raise ValueError(f"role {role!r} does not exist")
        self.db.execute(
            self.d.insert_ignore("auth_user_roles (user_id, role_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?)"),
            [user_id, self.d.to_id(row[0]), self.d.t(at), assigned_by],
        )

    def remove_user_role(self, user_id: str, role: str) -> None:
        if self._bad_id(user_id):
            return
        self.db.execute(
            "DELETE FROM auth_user_roles WHERE user_id = ? AND role_id = (SELECT id FROM auth_roles WHERE name = ?)",
            [user_id, role],
        )

    def count_active_users_with_role(self, role: str) -> int:
        row = self.db.query_one(
            "SELECT COUNT(*) FROM auth_user_roles ur JOIN auth_roles r ON r.id = ur.role_id "
            "JOIN auth_users u ON u.id = ur.user_id WHERE r.name = ? AND u.state = 'active'",
            [role],
        )
        return int(row[0])  # type: ignore[index]

    # ── audit ──

    def record_event(self, event: EventRecord) -> None:
        self.db.execute(
            "INSERT INTO auth_security_events (id, type, outcome, occurred_at, user_id, actor_id, ip_address, "
            "user_agent, request_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                event.id, event.type, event.outcome, self.d.t(event.occurred_at), event.user_id, event.actor_id,
                event.ip_address, event.user_agent, event.request_id, json.dumps(event.metadata or {}),
            ],
        )


class SqlRateLimitStore:
    """The shared rate-limit store (SEC-RATE-006): one row lock per key makes concurrent updates of
    a key serialize (SQLite takes the write lock when the transaction starts)."""

    def __init__(self, db: Database) -> None:
        self.db = db
        self.d = db.dialect
        self._key = self.d.ident("key")

    def update(self, key: str, fn: Callable[[RateLimitRecord | None], RateLimitRecord | None]) -> None:
        zero = self.d.t(from_millis(0))
        # Make sure the row exists first, outside the locking transaction: inserting inside it makes
        # two concurrent updates of a new key wait on each other's insert locks and deadlock (a new
        # row reads as window 0).
        self.db.execute(
            self.d.insert_ignore(
                f"auth_rate_limits ({self._key}, count, window_ends_at, blocked_until, strikes, last_block_at) "
                "VALUES (?, 0, ?, ?, 0, ?)"
            ),
            [key, zero, zero, zero],
        )
        # A deadlock victim is retried: the update has not been applied, so running it again is safe.
        for attempt in range(5):
            try:
                with self.db.transaction() as tx:
                    self._update(tx, key, fn)
                return
            except Exception as error:
                if not self.d.is_deadlock(error) or attempt == 4:
                    raise

    def _update(self, tx: Tx, key: str, fn: Callable[[RateLimitRecord | None], RateLimitRecord | None]) -> None:
        d = self.d
        row = tx.query_one(
            f"SELECT count, window_ends_at, blocked_until, strikes, last_block_at FROM auth_rate_limits "
            f"WHERE {self._key} = ?{d.lock}",
            [key],
        )
        record = RateLimitRecord(
            count=int(row[0]), window_ends_at=millis(d.read_time(row[1])),  # type: ignore[arg-type,index]
            blocked_until=millis(d.read_time(row[2])), strikes=int(row[3]),  # type: ignore[arg-type,index]
            last_block_at=millis(d.read_time(row[4])),  # type: ignore[arg-type,index]
        )
        current = record if record.window_ends_at != 0 else None
        nxt = fn(current)
        if nxt is None:
            return
        tx.execute(
            "UPDATE auth_rate_limits SET count = ?, window_ends_at = ?, blocked_until = ?, strikes = ?, "
            f"last_block_at = ? WHERE {self._key} = ?",
            [
                nxt.count, d.t(from_millis(nxt.window_ends_at)), d.t(from_millis(nxt.blocked_until)), nxt.strikes,
                d.t(from_millis(nxt.last_block_at)), key,
            ],
        )

    def delete(self, key: str) -> None:
        self.db.execute(f"DELETE FROM auth_rate_limits WHERE {self._key} = ?", [key])
