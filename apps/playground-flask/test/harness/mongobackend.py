"""A fresh MongoDB database with the indexes `migrate up` creates, so every case is isolated and
cases can run concurrently."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from app.auth.clock import iso
from app.auth.crypto import new_id
from app.store import mongostore
from test.harness.sqlbackend import MUTABLE


def _json(value: Any) -> Any:
    if isinstance(value, datetime):
        return iso(value)
    if isinstance(value, dict):
        return {k: _json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json(v) for v in value]
    return value


def _doc(doc: dict[str, Any], *drop: str) -> dict[str, Any]:
    out = {("id" if k == "_id" else k): _json(v) for k, v in doc.items()}
    for key in drop:
        out.pop(key, None)
    return out


class MongoBackend:
    def __init__(self) -> None:
        raw = os.environ.get("TEST_MONGODB_URL")
        if not raw:
            raise RuntimeError("TEST_MONGODB_URL is not set")
        parts = urlsplit(raw)
        url = urlunsplit(parts._replace(path="/t_" + new_id().replace("-", "")[:12]))
        self.db = mongostore.open_database(url)
        mongostore.ensure_indexes(self.db)
        self.store = mongostore.MongoStore(self.db)
        self.rate_limit_store = mongostore.MongoRateLimitStore(self.db)

    def close(self) -> None:
        client = self.db.client
        client.drop_database(self.db.name)
        client.close()

    def _find(self, collection: str, query: dict[str, Any], sort: str) -> list[dict[str, Any]]:
        return list(self.db[collection].find(query).sort(sort, 1))

    def inspect(self, entity: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        if entity == "user":
            for d in self._find(mongostore.USERS, {}, "createdAt"):
                user = _doc(d, "credential", "roles")
                user["roles"] = [r["name"] for r in d.get("roles", [])]
                out.append(user)
        elif entity == "credential":
            for d in self._find(mongostore.USERS, {"credential": {"$ne": None}}, "createdAt"):
                row = _doc(d["credential"])
                row["userId"], row["type"] = d["_id"], "password"
                out.append(row)
        elif entity == "session":
            out = [_doc(d) for d in self._find(mongostore.SESSIONS, {}, "createdAt")]
        elif entity in ("passwordResetToken", "emailVerificationToken"):
            kind = "passwordReset" if entity == "passwordResetToken" else "emailVerification"
            for d in self._find(mongostore.TOKENS, {"kind": kind}, "createdAt"):
                row = _doc(d, "kind")
                if not isinstance(row.get("email"), str):  # like the other drivers: only where the token has one
                    row.pop("email", None)
                out.append(row)
        else:
            raise ValueError(f"unknown entity {entity!r}")
        return out

    def events(self) -> list[dict[str, Any]]:
        out = []
        for d in self._find(mongostore.EVENTS, {}, "_id"):
            row = _doc(d)
            row.pop("_id", None)  # the event's own id is the "id" field; the ObjectId is only the order
            out.append(row)
        return out

    def mutate(self, entity: str, where: dict[str, Any], set_: dict[str, Any]) -> None:
        collection = {"user": mongostore.USERS, "session": mongostore.SESSIONS}.get(entity)
        if collection is None:
            raise ValueError(f"mutateStorage: unsupported entity {entity!r}")
        columns = MUTABLE[entity]

        def convert(fields: dict[str, Any]) -> dict[str, Any]:
            out: dict[str, Any] = {}
            for field, value in fields.items():
                if field not in columns:
                    raise ValueError(f"mutateStorage {entity}: unsupported field {field!r}")
                if isinstance(value, str) and field.endswith("At"):
                    value = datetime.fromisoformat(value.replace("Z", "+00:00"))
                out["_id" if field == "id" else field] = value
            return out

        update = convert(set_)
        if not update:
            raise ValueError("mutateStorage: nothing to set")
        self.db[collection].update_many(convert(where), {"$set": update})
