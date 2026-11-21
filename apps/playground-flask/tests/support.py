"""Fresh stores for the store tests: one isolated database per test, with the project's migrations
applied. Stores whose server is not configured are skipped, not failed.

    TEST_DATABASE_URL=postgresql://...   a PostgreSQL server (each test gets its own schema)
    TEST_MYSQL_URL=mysql://...           a MySQL server (each test gets its own database)
    TEST_MONGODB_URL=mongodb://...       a MongoDB server (each test gets its own database)

SQLite needs no server, and the memory store always runs.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit, urlunsplit

import pytest

from app.auth.crypto import new_id

ROOT = Path(__file__).resolve().parents[1]
# Inside the SelfAuth repository this project sits in apps/<name>; a generated project does not.
REPOSITORY = ROOT.parents[1] if len(ROOT.parents) > 1 and (ROOT.parents[1] / "packages" / "cli").exists() else None
STORES = ["memory", "sqlite", "postgresql", "mysql", "mongodb"]
ENV_VARS = {"postgresql": "TEST_DATABASE_URL", "mysql": "TEST_MYSQL_URL", "mongodb": "TEST_MONGODB_URL"}


@dataclass
class Fresh:
    store: Any
    rate_limit_store: Any
    close: Callable[[], None] = lambda: None
    url: str = ""
    cleanup: list[Callable[[], None]] = field(default_factory=list)


def configured_database() -> str:
    """The database this project was generated for (its selfauth.config.json)."""
    return json.loads((ROOT / "selfauth.config.json").read_text())["adapter"]["database"]


def migrations_dir(kind: str) -> Path | None:
    """The schema for `kind`: SELFAUTH_MIGRATIONS_DIR, the SelfAuth repository's derived schema, or
    the project's own db/migrations when it was generated for this database."""
    candidates = [os.environ.get("SELFAUTH_MIGRATIONS_DIR")]
    if REPOSITORY is not None and kind != "postgresql":
        candidates.append(str(REPOSITORY / "packages/cli/template-variants" / kind / "prisma/migrations"))
    if configured_database() == kind or (kind == "postgresql" and REPOSITORY is not None):
        candidates.append(str(ROOT / "db/migrations"))
    for candidate in candidates:
        if candidate and Path(candidate).is_dir() and any(Path(candidate).glob("*/migration.sql")):
            return Path(candidate)
    return None


def fresh(kind: str) -> Fresh:
    """A new empty store of `kind`, or a skipped test when it is not available here."""
    if kind == "memory":
        from app.auth.authz import role_definitions  # noqa: F401
        from app.auth.ratelimit import MemoryRateLimitStore
        from app.store.memory import MemoryStore

        return Fresh(MemoryStore(), MemoryRateLimitStore())
    if kind == "mongodb":
        pytest.importorskip("app.store.mongostore")
        raw = os.environ.get(ENV_VARS[kind])
        if not raw:
            pytest.skip(f"{ENV_VARS[kind]} is not set")
        from app.store import mongostore

        url = urlunsplit(urlsplit(raw)._replace(path="/t_" + new_id().replace("-", "")[:12]))
        db = mongostore.open_database(url)
        mongostore.ensure_indexes(db)
        out = Fresh(mongostore.MongoStore(db), mongostore.MongoRateLimitStore(db), url=url)
        out.close = lambda: (db.client.drop_database(db.name), db.client.close())  # type: ignore[assignment]
        return out

    pytest.importorskip("app.store.sqlstore")
    from app.store import migrations
    from app.store.dialect import Database
    from app.store.sqlstore import SqlRateLimitStore, SqlStore

    directory = migrations_dir(kind)
    if directory is None:
        pytest.skip(f"no {kind} migrations here (set SELFAUTH_MIGRATIONS_DIR)")
    out = Fresh(None, None)
    name = "t_" + new_id().replace("-", "")[:12]
    if kind == "sqlite":
        folder = tempfile.mkdtemp(prefix="selfauth-sqlite-")
        out.cleanup.append(lambda: shutil.rmtree(folder, ignore_errors=True))
        url = "file:" + os.path.join(folder, "app.db")
    else:
        raw = os.environ.get(ENV_VARS[kind])
        if not raw:
            pytest.skip(f"{ENV_VARS[kind]} is not set")
        admin = Database(raw)
        if kind == "mysql":
            admin.execute(f"CREATE DATABASE {name} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin")
            out.cleanup.append(lambda: (admin.execute(f"DROP DATABASE IF EXISTS {name}"), admin.close()))
            url = urlunsplit(urlsplit(raw)._replace(path="/" + name))
        else:
            admin.execute(f"CREATE SCHEMA {name}")
            out.cleanup.append(lambda: (admin.execute(f"DROP SCHEMA IF EXISTS {name} CASCADE"), admin.close()))
            url = f"{raw}{'&' if '?' in raw else '?'}options=-csearch_path%3D{name}"
    try:
        migrations.migrate(url, migrations.load(directory))
        db = Database(url)
    except BaseException:
        for fn in reversed(out.cleanup):
            fn()
        raise
    out.store, out.rate_limit_store, out.url = SqlStore(db), SqlRateLimitStore(db), url

    def close() -> None:
        db.close()
        for fn in reversed(out.cleanup):
            try:
                fn()
            except Exception:  # noqa: BLE001
                pass

    out.close = close
    return out
