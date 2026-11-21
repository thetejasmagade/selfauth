"""The stores the conformance harness runs against, each with the test-only views a driver needs
(DATA_MODEL.md entity names, camelCase fields, ISO dates)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol

from app.auth.clock import iso
from app.auth.ratelimit import MemoryRateLimitStore
from app.auth.store import EventRecord, Store
from app.store.memory import MemoryStore


def iso_or_none(value: datetime | None) -> str | None:
    return iso(value) if value is not None else None


def events_json(events: list[EventRecord]) -> list[dict[str, Any]]:
    return [
        {
            "id": e.id, "type": e.type, "outcome": e.outcome, "occurredAt": iso(e.occurred_at),
            "userId": e.user_id, "actorId": e.actor_id, "ipAddress": e.ip_address, "userAgent": e.user_agent,
            "requestId": e.request_id, "metadata": e.metadata,
        }
        for e in events
    ]


def check_mutation(entity: str, where: dict[str, Any], set_: dict[str, Any]) -> str:
    """Only the fields conformance cases change are supported; anything else fails loudly."""
    if entity != "user":
        raise ValueError(f'mutateStorage supports entity "user" only (got {entity!r})')
    for key in where:
        if key not in ("id", "email"):
            raise ValueError(f"mutateStorage user: unsupported filter {key!r}")
    for key in set_:
        if key != "state":
            raise ValueError(f"mutateStorage user: unsupported field {key!r}")
    state = set_.get("state")
    if not isinstance(state, str) or not state:
        raise ValueError("mutateStorage user: state is required")
    return state


class Backend(Protocol):
    store: Store
    rate_limit_store: Any

    def inspect(self, entity: str) -> list[dict[str, Any]]: ...

    def mutate(self, entity: str, where: dict[str, Any], set_: dict[str, Any]) -> None: ...

    def events(self) -> list[dict[str, Any]]: ...

    def close(self) -> None: ...


class MemoryBackend:
    def __init__(self) -> None:
        self.memory = MemoryStore()
        self.store = self.memory
        self.rate_limit_store = MemoryRateLimitStore()

    def inspect(self, entity: str) -> list[dict[str, Any]]:
        mem = self.memory
        with mem._lock:
            if entity == "user":
                return [
                    {
                        "id": u.id, "email": u.email, "emailNormalized": u.email_normalized,
                        "emailVerifiedAt": iso_or_none(u.email_verified_at), "state": u.state,
                        "createdAt": iso(u.created_at), "updatedAt": iso(u.updated_at),
                        "deletedAt": iso_or_none(u.deleted_at),
                        "roles": [r.role for r in mem.user_roles if r.user_id == u.id],
                    }
                    for u in mem.users.values()
                ]
            if entity == "credential":
                return [
                    {
                        "id": c.id, "userId": c.user_id, "type": c.type, "secretHash": c.secret_hash,
                        "createdAt": iso(c.created_at), "updatedAt": iso(c.updated_at),
                    }
                    for c in mem.credentials.values()
                ]
            if entity == "session":
                return [
                    {
                        "id": s.id, "tokenHash": s.token_hash, "userId": s.user_id, "createdAt": iso(s.created_at),
                        "lastSeenAt": iso(s.last_seen_at), "idleExpiresAt": iso(s.idle_expires_at),
                        "absoluteExpiresAt": iso(s.absolute_expires_at), "revokedAt": iso_or_none(s.revoked_at),
                        "revokedReason": s.revoked_reason, "ipAddress": s.ip_address, "userAgent": s.user_agent,
                        "reauthenticatedAt": iso_or_none(s.reauthenticated_at),
                    }
                    for s in mem.sessions.values()
                ]
            if entity in ("passwordResetToken", "emailVerificationToken"):
                kind = "emailVerification" if entity == "emailVerificationToken" else "passwordReset"
                return [
                    {
                        "id": t.id, "kind": t.kind, "userId": t.user_id, "tokenHash": t.token_hash, "email": t.email,
                        "expiresAt": iso(t.expires_at), "usedAt": iso_or_none(t.used_at),
                        "invalidatedAt": iso_or_none(t.invalidated_at), "createdAt": iso(t.created_at),
                    }
                    for t in mem.tokens.values()
                    if t.kind == kind
                ]
        raise ValueError(f"unknown entity {entity!r}")

    def mutate(self, entity: str, where: dict[str, Any], set_: dict[str, Any]) -> None:
        state = check_mutation(entity, where, set_)

        def matches(user: Any) -> bool:
            if "id" in where and where["id"] != user.id:
                return False
            if "email" in where and (user.email is None or where["email"] != user.email):
                return False
            return True

        self.memory.mutate_users(matches, lambda user: setattr(user, "state", state))

    def events(self) -> list[dict[str, Any]]:
        with self.memory._lock:
            return events_json(list(self.memory.events))

    def close(self) -> None:
        pass
