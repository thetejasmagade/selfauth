"""The auth store for MongoDB (PyMongo). It uses the same collections and document shapes as the
TypeScript and Go stores, so a database can move between the apps.

Atomicity (DATA-MODEL-002) without transactions, so it works on a standalone server as well as a
replica set:

* the credential and the role links are embedded in the user document, so creating a user is one
  write (all or nothing);
* token consumption and session revocation are conditional updates;
* rate-limit counters are updated with compare-and-swap on a version number, retried on a clash.

Indexes are created by `python -m app.cmd.migrate up`, never at start-up (DATA-MODEL-003); start-up
refuses to run without them, because the unique email index is what keeps accounts unique.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable
from urllib.parse import urlsplit

from pymongo import ASCENDING, MongoClient
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError, OperationFailure

from ..auth import store as st
from ..auth.clock import from_millis, millis
from ..auth.ratelimit import RateLimitRecord
from ..auth.store import EmailTaken, EventRecord, SessionRecord, Store, TokenRecord, UserPatch, UserRecord
from .dialect import DatabaseError

# Collection names (DATA_MODEL.md: the auth_ prefix, so nothing collides with the application's).
USERS, SESSIONS, TOKENS, ROLES, EVENTS, RATE_LIMITS = (
    "auth_users", "auth_sessions", "auth_one_time_tokens", "auth_roles", "auth_security_events", "auth_rate_limits",
)


def open_database(url: str) -> Database:
    """Connects to a mongodb:// or mongodb+srv:// URL (DATABASE_URL). The database is the path of the
    URL. It does not create indexes or seed anything (DATA-MODEL-003)."""
    parts = urlsplit(url)
    name = parts.path.lstrip("/")
    if parts.scheme not in ("mongodb", "mongodb+srv") or not parts.netloc:
        raise DatabaseError("invalid DATABASE_URL: expected mongodb://host:27017/database")
    if not name:
        raise DatabaseError("invalid DATABASE_URL: it must name a database, for example mongodb://localhost:27017/app")
    client: MongoClient = MongoClient(url, tz_aware=True, maxPoolSize=10, serverSelectionTimeoutMS=8000)
    try:
        client.admin.command("ping")
    except Exception as error:  # noqa: BLE001
        client.close()
        raise DatabaseError(f"cannot reach the database: {str(error).splitlines()[0]}") from None
    return client[name]


# ── indexes ──

# The names are MongoDB's defaults, which are also the ones the TypeScript and Go stores create.
_INDEXES: list[tuple[str, str, list[tuple[str, int]], bool, dict[str, Any] | None]] = [
    # Unique among non-deleted users: the address is cleared on deletion (IDENT-EMAIL-003).
    (USERS, "emailNormalized_1", [("emailNormalized", 1)], True, {"emailNormalized": {"$type": "string"}}),
    (USERS, "roles.name_1", [("roles.name", 1)], False, None),
    (SESSIONS, "tokenHash_1", [("tokenHash", 1)], True, None),
    (SESSIONS, "userId_1", [("userId", 1)], False, None),
    (SESSIONS, "absoluteExpiresAt_1", [("absoluteExpiresAt", 1)], False, None),
    (TOKENS, "kind_1_tokenHash_1", [("kind", 1), ("tokenHash", 1)], True, None),
    (TOKENS, "userId_1", [("userId", 1)], False, None),
    (EVENTS, "occurredAt_1", [("occurredAt", 1)], False, None),
    (EVENTS, "userId_1", [("userId", 1)], False, None),
]


def missing_indexes(db: Database) -> list[str]:
    """The indexes the database needs and does not have yet ("collection.name")."""
    have: dict[str, set[str]] = {}
    missing: list[str] = []
    for collection, name, _keys, _unique, _partial in _INDEXES:
        if collection not in have:
            try:
                have[collection] = {spec["name"] for spec in db[collection].list_indexes()}
            except OperationFailure as error:
                if error.code != 26:  # NamespaceNotFound: a collection that does not exist yet has none
                    raise
                have[collection] = set()
        if name not in have[collection]:
            missing.append(f"{collection}.{name}")
    return missing


def ensure_indexes(db: Database) -> list[str]:
    """Creates the missing indexes and returns their names. It never drops one."""
    wanted = set(missing_indexes(db))
    created: list[str] = []
    for collection, name, keys, unique, partial in _INDEXES:
        if f"{collection}.{name}" not in wanted:
            continue
        options: dict[str, Any] = {"name": name, "unique": unique}
        if partial is not None:
            options["partialFilterExpression"] = partial
        db[collection].create_index(keys, **options)
        created.append(f"{collection}.{name}")
    return created


# ── the store ──

_NO_CREDENTIAL = {"credential": 0}


def _user(doc: dict[str, Any] | None) -> UserRecord | None:
    if doc is None:
        return None
    return UserRecord(
        id=doc["_id"], email=doc.get("email"), email_normalized=doc.get("emailNormalized"),
        email_verified_at=doc.get("emailVerifiedAt"), state=doc["state"], created_at=doc["createdAt"],
        updated_at=doc["updatedAt"], deleted_at=doc.get("deletedAt"),
    )


def _session(doc: dict[str, Any] | None) -> SessionRecord | None:
    if doc is None:
        return None
    return SessionRecord(
        id=doc["_id"], token_hash=doc["tokenHash"], user_id=doc["userId"], created_at=doc["createdAt"],
        last_seen_at=doc["lastSeenAt"], idle_expires_at=doc["idleExpiresAt"],
        absolute_expires_at=doc["absoluteExpiresAt"], revoked_at=doc.get("revokedAt"),
        revoked_reason=doc.get("revokedReason"), ip_address=doc.get("ipAddress"), user_agent=doc.get("userAgent"),
        reauthenticated_at=doc.get("reauthenticatedAt"),
    )


class MongoStore(Store):
    def __init__(self, db: Database) -> None:
        self.users = db[USERS]
        self.sessions = db[SESSIONS]
        self.tokens = db[TOKENS]
        self.roles = db[ROLES]
        self.events = db[EVENTS]

    # users
    def create_user(self, user: UserRecord, password_hash: str, roles: list[str]) -> UserRecord:
        # Checked before anything is written, so a missing role leaves nothing behind (AUTHN-REG-003).
        for role in roles:
            if not self.role_exists(role):
                raise ValueError(f"role {role!r} does not exist")
        doc = {
            "_id": user.id, "email": user.email, "emailNormalized": user.email_normalized,
            "emailVerifiedAt": user.email_verified_at, "state": user.state, "createdAt": user.created_at,
            "updatedAt": user.updated_at, "deletedAt": user.deleted_at,
            # One document holds the user, the password credential and the role links: all or nothing.
            "credential": {"secretHash": password_hash, "createdAt": user.created_at, "updatedAt": user.created_at},
            "roles": [{"name": r, "assignedAt": user.created_at, "assignedBy": None} for r in roles],
        }
        try:
            self.users.insert_one(doc)
        except DuplicateKeyError as error:
            if "emailNormalized" in str(error):
                raise EmailTaken() from None
            raise
        return user

    def find_user_by_id(self, user_id: str) -> UserRecord | None:
        return _user(self.users.find_one({"_id": user_id}, _NO_CREDENTIAL))

    def find_user_by_email(self, email_normalized: str) -> UserRecord | None:
        return _user(self.users.find_one({"emailNormalized": email_normalized, "state": {"$ne": "deleted"}}, _NO_CREDENTIAL))

    def update_user(self, user_id: str, patch: UserPatch) -> None:
        fields: dict[str, Any] = {}
        if patch.state is not None:
            fields["state"] = patch.state
        if patch.email_verified_at is not None:
            fields["emailVerifiedAt"] = patch.email_verified_at
        if patch.updated_at is not None:
            fields["updatedAt"] = patch.updated_at
        if patch.deleted_at is not None:
            fields["deletedAt"] = patch.deleted_at
        if patch.clear_email:
            fields["email"] = None
            fields["emailNormalized"] = None
        if fields:
            self.users.update_one({"_id": user_id}, {"$set": fields})

    # credentials
    def get_password_hash(self, user_id: str) -> str | None:
        doc = self.users.find_one({"_id": user_id}, {"credential.secretHash": 1})
        credential = (doc or {}).get("credential")
        return credential["secretHash"] if credential else None

    def set_password_hash(self, user_id: str, password_hash: str, at: datetime) -> None:
        # Two conditional updates, each atomic: the first replaces the hash of an existing credential
        # and keeps its creation time; the second creates the credential when the user has none
        # (after delete_credentials).
        result = self.users.update_one(
            {"_id": user_id, "credential": {"$ne": None}},
            {"$set": {"credential.secretHash": password_hash, "credential.updatedAt": at}},
        )
        if result.matched_count == 0:
            self.users.update_one(
                {"_id": user_id, "credential": None},
                {"$set": {"credential": {"secretHash": password_hash, "createdAt": at, "updatedAt": at}}},
            )

    def delete_credentials(self, user_id: str) -> None:
        self.users.update_one({"_id": user_id}, {"$set": {"credential": None}})

    # sessions
    def create_session(self, session: SessionRecord) -> None:
        self.sessions.insert_one(
            {
                "_id": session.id, "tokenHash": session.token_hash, "userId": session.user_id,
                "createdAt": session.created_at, "lastSeenAt": session.last_seen_at,
                "idleExpiresAt": session.idle_expires_at, "absoluteExpiresAt": session.absolute_expires_at,
                "revokedAt": None, "revokedReason": None, "ipAddress": session.ip_address,
                "userAgent": session.user_agent, "reauthenticatedAt": session.reauthenticated_at,
            }
        )

    def find_session_by_token_hash(self, token_hash: str) -> SessionRecord | None:
        return _session(self.sessions.find_one({"tokenHash": token_hash}))

    def find_session_by_id(self, session_id: str) -> SessionRecord | None:
        return _session(self.sessions.find_one({"_id": session_id}))

    def touch_session(self, session_id: str, last_seen_at: datetime, idle_expires_at: datetime) -> None:
        self.sessions.update_one(
            {"_id": session_id, "revokedAt": None},
            {"$set": {"lastSeenAt": last_seen_at, "idleExpiresAt": idle_expires_at}},
        )

    def revoke_session(self, session_id: str, reason: str, at: datetime) -> None:
        self.sessions.update_one(
            {"_id": session_id, "revokedAt": None}, {"$set": {"revokedAt": at, "revokedReason": reason}}
        )

    def revoke_user_sessions(
        self, user_id: str, reason: str, at: datetime, except_session_id: str | None = None
    ) -> int:
        query: dict[str, Any] = {"userId": user_id, "revokedAt": None}
        if except_session_id:
            query["_id"] = {"$ne": except_session_id}
        result = self.sessions.update_many(query, {"$set": {"revokedAt": at, "revokedReason": reason}})
        return result.modified_count

    def list_active_sessions(self, user_id: str, now: datetime) -> list[SessionRecord]:
        cursor = self.sessions.find(
            {"userId": user_id, "revokedAt": None, "idleExpiresAt": {"$gt": now}, "absoluteExpiresAt": {"$gt": now}}
        ).sort("createdAt", ASCENDING)
        return [_session(d) for d in cursor]  # type: ignore[misc]

    # one-time tokens
    def create_token(self, token: TokenRecord) -> None:
        self.tokens.insert_one(
            {
                "_id": token.id, "kind": token.kind, "userId": token.user_id, "tokenHash": token.token_hash,
                "email": token.email, "expiresAt": token.expires_at, "usedAt": token.used_at,
                "invalidatedAt": token.invalidated_at, "createdAt": token.created_at,
            }
        )

    def find_token(self, kind: str, token_hash: str) -> TokenRecord | None:
        doc = self.tokens.find_one({"kind": kind, "tokenHash": token_hash})
        if doc is None:
            return None
        return TokenRecord(
            id=doc["_id"], kind=doc["kind"], user_id=doc["userId"], token_hash=doc["tokenHash"],
            email=doc.get("email"), expires_at=doc["expiresAt"], used_at=doc.get("usedAt"),
            invalidated_at=doc.get("invalidatedAt"), created_at=doc["createdAt"],
        )

    def consume_token(self, token_id: str, now: datetime) -> bool:
        # A conditional update: at most one concurrent caller succeeds (AUTHN-RESET-009, AUTHN-VERIFY-006).
        result = self.tokens.update_one(
            {"_id": token_id, "usedAt": None, "invalidatedAt": None, "expiresAt": {"$gt": now}},
            {"$set": {"usedAt": now}},
        )
        return result.modified_count == 1

    def invalidate_user_tokens(self, user_id: str, kind: str, at: datetime) -> None:
        query: dict[str, Any] = {"userId": user_id, "usedAt": None, "invalidatedAt": None}
        if kind != st.TOKENS_ALL:
            query["kind"] = kind
        self.tokens.update_many(query, {"$set": {"invalidatedAt": at}})

    # roles
    def sync_roles(self, roles: dict[str, list[str]]) -> None:
        """Upserts configured roles and makes each configured role's permissions exact. Roles no
        longer in configuration are kept (deleting them would silently strip users' roles); remove
        them with a reviewed change (AUTHZ-RBAC-005)."""
        for name, permissions in roles.items():
            self.roles.update_one(
                {"_id": name},
                {"$set": {"permissions": list(dict.fromkeys(permissions)), "isSystem": name in ("admin", "user")}},
                upsert=True,
            )

    def get_user_roles(self, user_id: str) -> list[str]:
        doc = self.users.find_one({"_id": user_id}, {"roles": 1})
        return [r["name"] for r in (doc or {}).get("roles", [])]

    def get_role_permissions(self, roles: list[str]) -> list[str]:
        if not roles:
            return []
        seen: dict[str, None] = {}
        for doc in self.roles.find({"_id": {"$in": roles}}):
            for permission in doc.get("permissions", []):
                seen.setdefault(permission)
        return list(seen)

    def role_exists(self, role: str) -> bool:
        return self.roles.count_documents({"_id": role}, limit=1) > 0

    def add_user_role(self, user_id: str, role: str, assigned_by: str | None, at: datetime) -> None:
        if not self.role_exists(role):
            raise ValueError(f"role {role!r} does not exist")
        # Atomic and idempotent: the filter matches only a user who does not have the role yet.
        self.users.update_one(
            {"_id": user_id, "roles.name": {"$ne": role}},
            {"$push": {"roles": {"name": role, "assignedAt": at, "assignedBy": assigned_by}}},
        )

    def remove_user_role(self, user_id: str, role: str) -> None:
        self.users.update_one({"_id": user_id}, {"$pull": {"roles": {"name": role}}})

    def count_active_users_with_role(self, role: str) -> int:
        return self.users.count_documents({"state": "active", "roles.name": role})

    # audit
    def record_event(self, event: EventRecord) -> None:
        self.events.insert_one(
            {
                "id": event.id, "type": event.type, "outcome": event.outcome, "occurredAt": event.occurred_at,
                "userId": event.user_id, "actorId": event.actor_id, "ipAddress": event.ip_address,
                "userAgent": event.user_agent, "requestId": event.request_id, "metadata": event.metadata or {},
            }
        )


class MongoRateLimitStore:
    """The shared rate-limit store (SEC-RATE-006): compare-and-swap on a version number."""

    def __init__(self, db: Database) -> None:
        self.c = db[RATE_LIMITS]

    def update(self, key: str, fn: Callable[[RateLimitRecord | None], RateLimitRecord | None]) -> None:
        # Concurrent updates of one key serialize: only one compare-and-swap wins, the rest re-read.
        for _ in range(100):
            doc = self.c.find_one({"_id": key})
            current = None
            if doc is not None:
                current = RateLimitRecord(
                    count=doc["count"], window_ends_at=millis(doc["windowEndsAt"]),
                    blocked_until=millis(doc["blockedUntil"]), strikes=doc["strikes"],
                    last_block_at=millis(doc["lastBlockAt"]),
                )
            nxt = fn(current)
            if nxt is None:
                return
            fields = {
                "count": nxt.count, "windowEndsAt": from_millis(nxt.window_ends_at),
                "blockedUntil": from_millis(nxt.blocked_until), "strikes": nxt.strikes,
                "lastBlockAt": from_millis(nxt.last_block_at),
            }
            if doc is None:
                try:
                    self.c.insert_one({"_id": key, "v": 1, **fields})
                    return
                except DuplicateKeyError:
                    continue  # another request created the row first
            result = self.c.update_one({"_id": key, "v": doc.get("v", 0)}, {"$set": {**fields, "v": doc.get("v", 0) + 1}})
            if result.modified_count == 1:
                return
        raise RuntimeError("rate-limit counter is too contended to update")

    def delete(self, key: str) -> None:
        self.c.delete_one({"_id": key})
