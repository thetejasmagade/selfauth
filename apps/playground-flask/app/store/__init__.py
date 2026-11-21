"""Chooses the persistence backend: the database named by `adapter.database` in selfauth.config.json,
opened from DATABASE_URL, or the in-memory store outside production."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Callable

from ..auth import authz
from ..auth.ratelimit import RateLimitStore
from ..auth.store import Store
from ..config import Config, Env
from .errors import DatabaseError

log = logging.getLogger("selfauth")

SQL_DATABASES = ("postgresql", "mysql", "sqlite")


@dataclass
class DB:
    """Your application's own access to the database, for your own tables or collections. It is the
    same connection SelfAuth uses: `sql` is set for PostgreSQL, MySQL and SQLite, `mongo` for MongoDB.
    Both are None on the in-memory store."""

    sql: Any = None
    mongo: Any = None


@dataclass
class Stores:
    store: Store
    rate_limit_store: RateLimitStore | None = None
    db: DB = field(default_factory=DB)
    close: Callable[[], None] = lambda: None


def _sql_modules() -> Any:
    try:
        from . import migrations, sqlstore  # noqa: F401
    except ImportError as error:  # a project only contains the databases it uses
        raise DatabaseError(f"this project has no SQL store ({error})") from None
    return migrations, sqlstore


def _mongo_module() -> Any:
    try:
        from . import mongostore
    except ImportError as error:
        raise DatabaseError(f"this project has no MongoDB store ({error})") from None
    return mongostore


def connect(database: str, url: str) -> Stores:
    """Opens the database named by adapter.database at url. It does not migrate or seed anything
    (DATA-MODEL-003)."""
    if database == "mongodb":
        mongostore = _mongo_module()
        db = mongostore.open_database(url)
        # The unique email index is what keeps accounts unique, so the server refuses to run without it.
        missing = mongostore.missing_indexes(db)
        if missing:
            db.client.close()
            raise DatabaseError(
                f"the database is missing indexes ({', '.join(missing)}): run `python -m app.cmd.migrate up` first"
            )
        return Stores(
            mongostore.MongoStore(db), mongostore.MongoRateLimitStore(db), DB(mongo=db), db.client.close
        )
    if database in SQL_DATABASES:
        _, sqlstore = _sql_modules()
        from .dialect import Database, kind_of_url

        if kind_of_url(url) != database:
            raise DatabaseError(f"DATABASE_URL does not match adapter.database ({database}) in selfauth.config.json")
        db = Database(url)
        return Stores(sqlstore.SqlStore(db), sqlstore.SqlRateLimitStore(db), DB(sql=db), db.close)
    raise DatabaseError(f"database {database!r} is not built into this project")


def migration_status(database: str, url: str, directory: str) -> tuple[list[str], list[str]]:
    """(applied, pending) in `directory`, without changing anything. MongoDB has no migrations, only
    indexes: "pending" lists the indexes `migrate up` would create."""
    if database == "mongodb":
        mongostore = _mongo_module()
        db = mongostore.open_database(url)
        try:
            return [], mongostore.missing_indexes(db)
        finally:
            db.client.close()
    migrations, _ = _sql_modules()
    status = migrations.status(url, migrations.load(directory))
    return status.applied, status.pending


def migrate(database: str, url: str, directory: str) -> list[str]:
    """Applies the pending migrations in `directory` (or creates the missing MongoDB indexes) and
    returns their names."""
    if database == "mongodb":
        mongostore = _mongo_module()
        db = mongostore.open_database(url)
        try:
            return mongostore.ensure_indexes(db)
        finally:
            db.client.close()
    migrations, _ = _sql_modules()
    return migrations.migrate(url, migrations.load(directory))


def new(config: Config, env: Env) -> Stores:
    """Creates the store for `config`. With a database configured it uses DATABASE_URL; without one it
    falls back to the in-memory store outside production. It never migrates or seeds a database on
    startup (DATA-MODEL-003, AUTHZ-RBAC-005): run `python -m app.cmd.migrate up` and
    `python -m app.cmd.seed` first."""
    database = config.adapter.database
    url = os.environ.get("DATABASE_URL", "")
    if database != "memory" and url:
        stores = connect(database, url)
        for role in config.authorization.default_roles:
            try:
                present = stores.store.role_exists(role)
            except Exception as error:  # noqa: BLE001
                stores.close()
                raise DatabaseError(f"cannot read roles (did you run the migrations?): {error}") from None
            if not present:
                stores.close()
                raise DatabaseError(
                    f"role {role!r} is missing in the database: run `python -m app.cmd.migrate up` and "
                    "`python -m app.cmd.seed` first"
                )
        log.info("Using %s store.", database)
        return stores
    if env.production:
        raise DatabaseError(
            "DATABASE_URL is required in production; the in-memory store loses all data on restart"
        )
    from .memory import MemoryStore

    memory = MemoryStore()
    # Memory does not persist, so roles are synchronized on every start.
    memory.sync_roles(authz.role_definitions(config))
    log.info("Using in-memory store (set DATABASE_URL to use %s).", database)
    return Stores(memory)
