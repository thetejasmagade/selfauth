"""SQL stores for the conformance harness: one fresh SQLite file, MySQL database or PostgreSQL
schema with the migrations applied, so every case is isolated and cases can run concurrently."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from app.auth.clock import iso
from app.auth.crypto import new_id
from app.store import migrations
from app.store.dialect import MYSQL, POSTGRES, SQLITE, Database
from app.store.sqlstore import SqlRateLimitStore, SqlStore
from test.harness.backends import events_json  # noqa: F401  (kept for parity with the memory backend)

ROOT = Path(__file__).resolve().parents[2]

# Columns a conformance case may change or match, by logical field name. Names are checked against
# this list, never interpolated from the request.
MUTABLE = {
    "user": {"id": "id", "email": "email", "state": "state", "emailVerifiedAt": "email_verified_at"},
    "session": {
        "id": "id", "userId": "user_id", "revokedAt": "revoked_at", "revokedReason": "revoked_reason",
        "idleExpiresAt": "idle_expires_at", "absoluteExpiresAt": "absolute_expires_at",
        "reauthenticatedAt": "reauthenticated_at",
    },
}
TABLES = {"user": "auth_users", "session": "auth_sessions"}


def camel(column: str) -> str:
    head, *rest = column.split("_")
    return head + "".join(p[:1].upper() + p[1:] for p in rest)


def migrations_for(kind: str) -> list[migrations.Migration]:
    """The schema derived for this database: SELFAUTH_MIGRATIONS_DIR, else the reference's
    packages/cli/template-variants, else the project's own db/migrations."""
    candidates = [
        os.environ.get("SELFAUTH_MIGRATIONS_DIR"),
        ROOT.parents[1] / "packages" / "cli" / "template-variants" / kind / "prisma" / "migrations"
        if kind != POSTGRES
        else None,
        ROOT / "db" / "migrations",
    ]
    for directory in candidates:
        if not directory:
            continue
        try:
            found = migrations.load(directory)
        except Exception:  # noqa: BLE001
            continue
        if found:
            return found
    raise RuntimeError(f"no {kind} migrations found (set SELFAUTH_MIGRATIONS_DIR)")


class SqlBackend:
    def __init__(self, kind: str) -> None:
        self.kind = kind
        self._cleanup: list[Any] = []
        name = "t_" + new_id().replace("-", "")[:12]
        if kind == SQLITE:
            directory = tempfile.mkdtemp(prefix="selfauth-sqlite-")
            self._cleanup.append(lambda: shutil.rmtree(directory, ignore_errors=True))
            url = "file:" + os.path.join(directory, "app.db")
        elif kind == MYSQL:
            admin_url = os.environ.get("TEST_MYSQL_URL")
            if not admin_url:
                raise RuntimeError("TEST_MYSQL_URL is not set")
            admin = Database(admin_url)
            admin.execute(f"CREATE DATABASE {name} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin")
            self._cleanup.append(lambda: (admin.execute(f"DROP DATABASE IF EXISTS {name}"), admin.close()))
            parts = urlsplit(admin_url)
            url = urlunsplit(parts._replace(path="/" + name))
        elif kind == POSTGRES:
            admin_url = os.environ.get("TEST_DATABASE_URL")
            if not admin_url:
                raise RuntimeError("TEST_DATABASE_URL is not set")
            admin = Database(admin_url)
            admin.execute(f"CREATE SCHEMA {name}")
            self._cleanup.append(lambda: (admin.execute(f"DROP SCHEMA IF EXISTS {name} CASCADE"), admin.close()))
            sep = "&" if "?" in admin_url else "?"
            url = f"{admin_url}{sep}options=-csearch_path%3D{name}"
        else:
            raise RuntimeError(f"unsupported SQL store {kind!r}")
        try:
            migrations.migrate(url, migrations_for(kind))
            self.db = Database(url)
        except BaseException:
            self.close()
            raise
        self.store = SqlStore(self.db)
        self.rate_limit_store = SqlRateLimitStore(self.db)

    def close(self) -> None:
        db = getattr(self, "db", None)
        if db is not None:
            db.close()
        for fn in reversed(self._cleanup):
            try:
                fn()
            except Exception:  # noqa: BLE001
                pass
        self._cleanup = []

    # ── views ──

    def _value(self, column: str, value: Any) -> Any:
        if isinstance(value, (bytes, bytearray)):
            return bytes(value).decode()
        if column.endswith("_at") and value is not None:
            read = self.db.dialect.read_time(value)
            return iso(read) if isinstance(read, datetime) else value
        if column.endswith("id") and value is not None and not isinstance(value, str):
            return str(value)
        if column in ("state", "type", "outcome", "revoked_reason") and value is not None:
            return str(value)
        if column == "token_hash" and isinstance(value, str):
            return value.strip()
        return value

    def _rows(self, sql: str, columns: list[str]) -> list[dict[str, Any]]:
        return [{camel(c): self._value(c, v) for c, v in zip(columns, row)} for row in self.db.query(sql)]

    def inspect(self, entity: str) -> list[dict[str, Any]]:
        if entity == "user":
            columns = "id email email_normalized email_verified_at state created_at updated_at deleted_at".split()
            users = self._rows(f"SELECT {', '.join(columns)} FROM auth_users ORDER BY created_at ASC", columns)
            for user in users:
                user["roles"] = self.store.get_user_roles(user["id"])
            return users
        if entity == "credential":
            columns = "id user_id type secret_hash created_at updated_at".split()
            return self._rows(f"SELECT {', '.join(columns)} FROM auth_credentials ORDER BY created_at ASC", columns)
        if entity == "session":
            columns = (
                "id token_hash user_id created_at last_seen_at idle_expires_at absolute_expires_at revoked_at "
                "revoked_reason ip_address user_agent reauthenticated_at"
            ).split()
            return self._rows(f"SELECT {', '.join(columns)} FROM auth_sessions ORDER BY created_at ASC", columns)
        if entity == "passwordResetToken":
            columns = "id user_id token_hash expires_at used_at invalidated_at created_at".split()
            return self._rows(
                f"SELECT {', '.join(columns)} FROM auth_password_reset_tokens ORDER BY created_at ASC", columns
            )
        if entity == "emailVerificationToken":
            columns = "id user_id token_hash email expires_at used_at invalidated_at created_at".split()
            return self._rows(
                f"SELECT {', '.join(columns)} FROM auth_email_verification_tokens ORDER BY created_at ASC", columns
            )
        raise ValueError(f"unknown entity {entity!r}")

    def events(self) -> list[dict[str, Any]]:
        # Insertion order: PostgreSQL and MySQL have a seq column, SQLite's rowid is the same counter.
        order = "rowid" if self.kind == SQLITE else "seq"
        columns = "id type outcome occurred_at user_id actor_id ip_address user_agent request_id metadata".split()
        rows = self._rows(f"SELECT {', '.join(columns)} FROM auth_security_events ORDER BY {order} ASC", columns)
        for row in rows:
            if isinstance(row["metadata"], str):
                row["metadata"] = json.loads(row["metadata"])
        return rows

    def mutate(self, entity: str, where: dict[str, Any], set_: dict[str, Any]) -> None:
        columns = MUTABLE.get(entity)
        if columns is None:
            raise ValueError(f"mutateStorage: unsupported entity {entity!r}")
        args: list[Any] = []

        def clause(fields: dict[str, Any], sep: str) -> str:
            parts = []
            for field, value in fields.items():
                column = columns.get(field)
                if column is None:
                    raise ValueError(f"mutateStorage {entity}: unsupported field {field!r}")
                if isinstance(value, str) and column.endswith("_at"):
                    value = self.db.dialect.t(datetime.fromisoformat(value.replace("Z", "+00:00")))
                args.append(value)
                parts.append(f"{column} = ?")
            return sep.join(parts)

        set_sql = clause(set_, ", ")
        where_sql = clause(where, " AND ") or "1 = 1"
        if not set_sql:
            raise ValueError("mutateStorage: nothing to set")
        self.db.execute(f"UPDATE {TABLES[entity]} SET {set_sql} WHERE {where_sql}", args)


def make_backend(store: str) -> SqlBackend:
    kinds = {"postgres": POSTGRES, "postgresql": POSTGRES, "sqlite": SQLITE, "mysql": MYSQL}
    if store in kinds:
        return SqlBackend(kinds[store])
    if store == "mongodb":
        from test.harness.mongobackend import MongoBackend

        return MongoBackend()  # type: ignore[return-value]
    raise ValueError(f"unknown store {store!r}")
