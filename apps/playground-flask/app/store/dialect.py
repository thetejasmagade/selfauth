"""The database layer for the SQL stores: one small interface over PostgreSQL (psycopg), MySQL
(PyMySQL) and SQLite (sqlite3). The three differ in a handful of places, all in this file: how a time
is stored, how a duplicate is written or ignored, how a unique violation is recognised, whether a row
can be locked and how a transaction begins.

SQL in the stores is written once, with `?` placeholders, and translated here.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator, Sequence
from urllib.parse import unquote, urlsplit

from .errors import DatabaseError

POSTGRES, MYSQL, SQLITE = "postgresql", "mysql", "sqlite"
KINDS = (POSTGRES, MYSQL, SQLITE)


# ── dialects ──


class Dialect:
    kind: str
    #: Appended to a SELECT that must hold its row until the transaction ends.
    lock = ""
    #: Finishes the credentials INSERT so a second write replaces the hash.
    upsert_credential = ""
    #: Finishes the roles INSERT so a second write refreshes is_system.
    upsert_role = ""

    def t(self, value: datetime | None) -> Any:
        """A time as it goes into a query."""
        raise NotImplementedError

    def read_time(self, value: Any) -> datetime | None:
        """A stored time as a timezone-aware UTC datetime."""
        raise NotImplementedError

    def insert_ignore(self, rest: str) -> str:
        """An INSERT that does nothing when the row already exists. `rest` follows `INTO`."""
        raise NotImplementedError

    def is_duplicate(self, error: BaseException, column: str) -> bool:
        raise NotImplementedError

    def is_missing_table(self, error: BaseException) -> bool:
        raise NotImplementedError

    def is_deadlock(self, error: BaseException) -> bool:
        return False

    def ident(self, name: str) -> str:
        """Quotes a column that is a reserved word."""
        return f'"{name}"'

    def to_id(self, value: Any) -> str | None:
        return None if value is None else str(value)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


class PostgresDialect(Dialect):
    kind = POSTGRES
    lock = " FOR UPDATE"
    upsert_credential = (
        "ON CONFLICT (user_id, type) DO UPDATE SET secret_hash = excluded.secret_hash, updated_at = excluded.updated_at"
    )
    upsert_role = "ON CONFLICT (name) DO UPDATE SET is_system = excluded.is_system"

    def t(self, value: datetime | None) -> Any:
        return None if value is None else _utc(value)

    def read_time(self, value: Any) -> datetime | None:
        return None if value is None else _utc(value)

    def insert_ignore(self, rest: str) -> str:
        return f"INSERT INTO {rest} ON CONFLICT DO NOTHING"

    def is_duplicate(self, error: BaseException, column: str) -> bool:
        import psycopg.errors

        if not isinstance(error, psycopg.errors.UniqueViolation):
            return False
        return column in (error.diag.constraint_name or "") or column in str(error)

    def is_missing_table(self, error: BaseException) -> bool:
        import psycopg.errors

        return isinstance(error, psycopg.errors.UndefinedTable)

    def is_deadlock(self, error: BaseException) -> bool:
        import psycopg.errors

        return isinstance(error, (psycopg.errors.DeadlockDetected, psycopg.errors.SerializationFailure))


class MySQLDialect(Dialect):
    kind = MYSQL
    lock = " FOR UPDATE"
    upsert_credential = "ON DUPLICATE KEY UPDATE secret_hash = VALUES(secret_hash), updated_at = VALUES(updated_at)"
    upsert_role = "ON DUPLICATE KEY UPDATE is_system = VALUES(is_system)"

    def t(self, value: datetime | None) -> Any:
        return None if value is None else _utc(value).replace(tzinfo=None)

    def read_time(self, value: Any) -> datetime | None:
        return None if value is None else _utc(value)

    def insert_ignore(self, rest: str) -> str:
        return f"INSERT IGNORE INTO {rest}"

    def ident(self, name: str) -> str:
        return f"`{name}`"

    def is_duplicate(self, error: BaseException, column: str) -> bool:
        import pymysql

        return isinstance(error, pymysql.err.IntegrityError) and error.args[0] == 1062 and column in str(error.args[1])

    def is_missing_table(self, error: BaseException) -> bool:
        import pymysql

        return isinstance(error, pymysql.err.ProgrammingError) and error.args[0] == 1146

    def is_deadlock(self, error: BaseException) -> bool:
        import pymysql

        return isinstance(error, pymysql.err.OperationalError) and error.args[0] in (1213, 1205)


class SQLiteDialect(Dialect):
    """SQLite keeps milliseconds since the epoch, which is what Prisma writes, so a file can move
    between the TypeScript, Go and Python apps."""

    kind = SQLITE
    upsert_credential = (
        "ON CONFLICT (user_id, type) DO UPDATE SET secret_hash = excluded.secret_hash, updated_at = excluded.updated_at"
    )
    upsert_role = "ON CONFLICT (name) DO UPDATE SET is_system = excluded.is_system"

    def t(self, value: datetime | None) -> Any:
        if value is None:
            return None
        value = _utc(value)
        return (value - datetime(1970, 1, 1, tzinfo=timezone.utc)) // _MS

    def read_time(self, value: Any) -> datetime | None:
        if value is None:
            return None
        if isinstance(value, (bytes, bytearray)):
            value = value.decode()
        if isinstance(value, str):
            value = int(value)
        return _EPOCH + _MS * int(value)

    def insert_ignore(self, rest: str) -> str:
        return f"INSERT OR IGNORE INTO {rest}"

    def is_duplicate(self, error: BaseException, column: str) -> bool:
        return (
            isinstance(error, sqlite3.IntegrityError)
            and "UNIQUE constraint failed" in str(error)
            and column in str(error)
        )

    def is_missing_table(self, error: BaseException) -> bool:
        return isinstance(error, sqlite3.OperationalError) and "no such table" in str(error)


_MS = timedelta(milliseconds=1)
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def dialect_for(kind: str) -> Dialect:
    if kind == POSTGRES:
        return PostgresDialect()
    if kind == MYSQL:
        return MySQLDialect()
    if kind == SQLITE:
        return SQLiteDialect()
    raise DatabaseError(f"unsupported database {kind!r}")


def kind_of_url(url: str) -> str:
    """Which database a DATABASE_URL points at."""
    scheme = url.split(":", 1)[0].lower()
    if scheme in ("postgres", "postgresql"):
        return POSTGRES
    if scheme == "mysql":
        return MYSQL
    if scheme in ("file", "sqlite"):
        return SQLITE
    raise DatabaseError(
        "invalid DATABASE_URL: expected postgresql://, mysql:// or file: (for example postgresql://user:password@host:5432/db)"
    )


# ── connections ──


class _Conn:
    """One live connection. Statements use `?` placeholders; `run` returns (rows, rowcount)."""

    def run(self, sql: str, params: Sequence[Any] = ()) -> tuple[list[tuple], int]:
        raise NotImplementedError

    def begin(self) -> None:
        raise NotImplementedError

    def commit(self) -> None:
        raise NotImplementedError

    def rollback(self) -> None:
        raise NotImplementedError

    def close(self) -> None:
        raise NotImplementedError

    def is_open(self) -> bool:
        return True


class _PgConn(_Conn):
    def __init__(self, url: str) -> None:
        import psycopg

        try:
            self._c = psycopg.connect(url, autocommit=True, connect_timeout=10)
        except psycopg.OperationalError as error:
            raise DatabaseError(f"cannot reach the database: {_first_line(error)}") from None

    def run(self, sql: str, params: Sequence[Any] = ()) -> tuple[list[tuple], int]:
        with self._c.cursor() as cur:
            cur.execute(sql.replace("?", "%s") if params else sql, tuple(params) if params else None)
            rows = cur.fetchall() if cur.description is not None else []
            return rows, cur.rowcount

    def begin(self) -> None:
        self._c.execute("BEGIN")

    def commit(self) -> None:
        self._c.execute("COMMIT")

    def rollback(self) -> None:
        self._c.execute("ROLLBACK")

    def close(self) -> None:
        self._c.close()

    def is_open(self) -> bool:
        return not self._c.closed and not self._c.broken


class _MySqlConn(_Conn):
    def __init__(self, url: str, multi: bool) -> None:
        import pymysql
        from pymysql.constants import CLIENT

        parts = urlsplit(url)
        if parts.scheme != "mysql" or not parts.hostname:
            raise DatabaseError("invalid DATABASE_URL: expected mysql://user:password@host:3306/database")
        try:
            self._c = pymysql.connect(
                host=parts.hostname,
                port=parts.port or 3306,
                user=unquote(parts.username or ""),
                password=unquote(parts.password or ""),
                database=parts.path.lstrip("/") or None,
                charset="utf8mb4",
                init_command="SET NAMES utf8mb4 COLLATE utf8mb4_bin",
                autocommit=True,
                connect_timeout=10,
                client_flag=CLIENT.MULTI_STATEMENTS if multi else 0,
            )
        except pymysql.err.OperationalError as error:
            raise DatabaseError(f"cannot reach the database: {error.args[-1] if error.args else error}") from None

    def run(self, sql: str, params: Sequence[Any] = ()) -> tuple[list[tuple], int]:
        with self._c.cursor() as cur:
            cur.execute(sql.replace("?", "%s") if params else sql, tuple(params) if params else None)
            rows = list(cur.fetchall()) if cur.description is not None else []
            count = cur.rowcount
            while cur.nextset():  # a file of several statements
                pass
            return rows, count

    def begin(self) -> None:
        self._c.begin()

    def commit(self) -> None:
        self._c.commit()

    def rollback(self) -> None:
        self._c.rollback()

    def close(self) -> None:
        self._c.close()

    def is_open(self) -> bool:
        return bool(self._c.open)


class _SqliteConn(_Conn):
    def __init__(self, url: str) -> None:
        path = url.removeprefix("sqlite:").removeprefix("file:").split("?", 1)[0]
        if not path or url.startswith(("mysql:", "postgres")):
            raise DatabaseError("invalid DATABASE_URL: expected a file, for example file:./app.db")
        # Autocommit mode: a transaction is an explicit BEGIN IMMEDIATE, which takes the write lock
        # at once, so two of them never deadlock on a lock upgrade.
        self._c = sqlite3.connect(path, isolation_level=None, check_same_thread=False, timeout=5)
        self._c.execute("PRAGMA busy_timeout = 5000")
        self._c.execute("PRAGMA foreign_keys = ON")
        # Switching to WAL can fail at once with "database is locked" while another process writes
        # (busy_timeout is not consulted), so a busy answer is retried for a few seconds.
        deadline = time.monotonic() + 5
        while True:
            try:
                self._c.execute("PRAGMA journal_mode = WAL")
                break
            except sqlite3.OperationalError as error:
                if "locked" not in str(error) or time.monotonic() > deadline:
                    raise DatabaseError(f"cannot reach the database: {error}") from None
                time.sleep(0.02)

    def run(self, sql: str, params: Sequence[Any] = ()) -> tuple[list[tuple], int]:
        cur = self._c.execute(sql, tuple(params))
        rows = cur.fetchall() if cur.description is not None else []
        return rows, cur.rowcount

    def script(self, sql: str) -> None:
        self._c.executescript(sql)

    def begin(self) -> None:
        self._c.execute("BEGIN IMMEDIATE")

    def commit(self) -> None:
        self._c.execute("COMMIT")

    def rollback(self) -> None:
        if self._c.in_transaction:
            self._c.execute("ROLLBACK")

    def close(self) -> None:
        self._c.close()


def _first_line(error: BaseException) -> str:
    return (str(error).strip().splitlines() or ["unknown error"])[0]


class Tx:
    """A transaction: the same calls as `Database`, on one connection."""

    def __init__(self, conn: _Conn) -> None:
        self._conn = conn

    def execute(self, sql: str, params: Sequence[Any] = ()) -> int:
        return self._conn.run(sql, params)[1]

    def query(self, sql: str, params: Sequence[Any] = ()) -> list[tuple]:
        return self._conn.run(sql, params)[0]

    def query_one(self, sql: str, params: Sequence[Any] = ()) -> tuple | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None


class Database:
    """Connects lazily and keeps one connection per thread, so a threaded server never shares one."""

    def __init__(self, url: str, *, multi_statements: bool = False) -> None:
        self.url = url
        self.kind = kind_of_url(url)
        self.dialect = dialect_for(self.kind)
        self._multi = multi_statements
        self._local = threading.local()
        self._all: list[_Conn] = []
        self._guard = threading.Lock()
        self._connect()  # fail early, with a readable message

    def _connect(self) -> _Conn:
        if self.kind == POSTGRES:
            conn: _Conn = _PgConn(self.url)
        elif self.kind == MYSQL:
            conn = _MySqlConn(self.url, self._multi)
        else:
            conn = _SqliteConn(self.url)
        with self._guard:
            self._all.append(conn)
        self._local.conn = conn
        return conn

    def _conn(self) -> _Conn:
        conn = getattr(self._local, "conn", None)
        if conn is not None and conn.is_open():
            return conn
        if conn is not None:
            self._drop(conn)
        return self._connect()

    def _drop(self, conn: _Conn) -> None:
        with self._guard:
            if conn in self._all:
                self._all.remove(conn)
        try:
            conn.close()
        except Exception:  # noqa: BLE001 - already broken
            pass
        if getattr(self._local, "conn", None) is conn:
            self._local.conn = None

    def execute(self, sql: str, params: Sequence[Any] = ()) -> int:
        return self._conn().run(sql, params)[1]

    def query(self, sql: str, params: Sequence[Any] = ()) -> list[tuple]:
        return self._conn().run(sql, params)[0]

    def query_one(self, sql: str, params: Sequence[Any] = ()) -> tuple | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def script(self, sql: str) -> None:
        """Runs a file of several statements (a migration)."""
        conn = self._conn()
        if isinstance(conn, _SqliteConn):
            conn.script(sql)
        else:
            conn.run(sql)

    @contextmanager
    def transaction(self) -> Iterator[Tx]:
        conn = self._conn()
        conn.begin()
        try:
            yield Tx(conn)
        except BaseException:
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001 - the original error matters more
                self._drop(conn)
            raise
        conn.commit()

    def close(self) -> None:
        with self._guard:
            conns, self._all = self._all, []
        for conn in conns:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
        self._local = threading.local()


__all__ = [
    "Database", "DatabaseError", "Dialect", "KINDS", "MYSQL", "POSTGRES", "SQLITE", "Tx", "dialect_for", "kind_of_url",
]
