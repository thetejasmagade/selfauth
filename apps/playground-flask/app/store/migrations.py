"""A deliberately small migration runner: SQL files applied in name order, each recorded with a
checksum so an applied migration that was edited afterwards is detected. It runs only when you ask
(never at startup: DATA-MODEL-003). Read each new migration before you apply it.

A migration is a directory of db/migrations holding migration.sql.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .dialect import MYSQL, POSTGRES, SQLITE, Database, Tx
from .errors import DatabaseError

#: Serializes concurrent migrators (two deploys starting at once).
_PG_LOCK_KEY = 7262230001


@dataclass
class Migration:
    name: str
    sql: str
    checksum: str


@dataclass
class Status:
    applied: list[str] = field(default_factory=list)
    pending: list[str] = field(default_factory=list)


def load(directory: str | Path) -> list[Migration]:
    """Reads directory/<name>/migration.sql for every <name>, in name order."""
    root = Path(directory)
    if not root.is_dir():
        raise DatabaseError(f"read migrations: {root} is not a directory")
    out: list[Migration] = []
    for entry in sorted(p for p in root.iterdir() if p.is_dir()):
        file = entry / "migration.sql"
        if not file.is_file():
            raise DatabaseError(f"migration {entry.name}: migration.sql is missing")
        data = file.read_bytes()
        out.append(Migration(entry.name, data.decode(), hashlib.sha256(data).hexdigest()))
    return out


def classify(all_: list[Migration], done: dict[str, str]) -> Status:
    """Compares the migrations on disk with the applied ones (name -> checksum)."""
    status = Status()
    known = {m.name for m in all_}
    for m in all_:
        checksum = done.get(m.name)
        if checksum is None:
            status.pending.append(m.name)
        elif checksum != m.checksum:
            raise DatabaseError(
                f"migration {m.name} was applied and has been edited since; "
                "add a new migration instead of changing an applied one"
            )
        else:
            status.applied.append(m.name)
    for name in done:
        if name not in known:
            raise DatabaseError(f"the database has migration {name}, which is not in the migrations directory")
    return status


_ENSURE = {
    POSTGRES: "CREATE TABLE IF NOT EXISTS selfauth_migrations (name text PRIMARY KEY, checksum text NOT NULL, "
    "applied_at timestamptz NOT NULL DEFAULT now())",
    MYSQL: "CREATE TABLE IF NOT EXISTS selfauth_migrations (name VARCHAR(255) NOT NULL PRIMARY KEY, "
    "checksum VARCHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin",
    SQLITE: "CREATE TABLE IF NOT EXISTS selfauth_migrations (name TEXT NOT NULL PRIMARY KEY, "
    "checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)",
}


def _applied(q: Database | Tx, db: Database) -> dict[str, str]:
    try:
        return {row[0]: row[1] for row in q.query("SELECT name, checksum FROM selfauth_migrations")}
    except Exception as error:
        if db.dialect.is_missing_table(error):
            return {}
        raise


def status(url: str, all_: list[Migration]) -> Status:
    """Applied and pending migrations, without changing anything."""
    db = Database(url)
    try:
        return classify(all_, _applied(db, db))
    finally:
        db.close()


def migrate(url: str, all_: list[Migration]) -> list[str]:
    """Applies every pending migration and returns the names it applied. SQLite runs each file in a
    transaction. PostgreSQL does the same; MySQL commits DDL as it goes, so a file that fails halfway
    leaves its earlier statements in place: restore from a backup, fix the file and run again."""
    db = Database(url, multi_statements=True)
    try:
        if db.kind == MYSQL:
            if db.query_one("SELECT GET_LOCK('selfauth_migrate', 30)") != (1,):
                raise DatabaseError("another migration is running (could not get the migration lock)")
            try:
                return _run(db, db, all_)
            finally:
                db.query("SELECT RELEASE_LOCK('selfauth_migrate')")
        if db.kind == POSTGRES:
            with db.transaction() as tx:
                tx.query("SELECT pg_advisory_xact_lock(?)", [_PG_LOCK_KEY])
                return _run(tx, db, all_)
        # SQLite: one immediate transaction for the whole run. It holds the write lock, so
        # concurrent migrators queue, and SQLite DDL is transactional.
        with db.transaction() as tx:
            return _run(tx, db, all_, script=False)
    finally:
        db.close()


def _run(q: Database | Tx, db: Database, all_: list[Migration], script: bool = True) -> list[str]:
    q.execute(_ENSURE[db.kind])
    plan = classify(all_, _applied(q, db))
    pending = set(plan.pending)
    ran: list[str] = []
    for m in all_:
        if m.name not in pending:
            continue
        try:
            if db.kind == SQLITE:
                _sqlite_script(q, m.sql)
            else:
                q.execute(m.sql)
        except Exception as error:
            raise DatabaseError(f"migration {m.name}: {error}") from error
        q.execute(
            "INSERT INTO selfauth_migrations (name, checksum, applied_at) VALUES (?, ?, ?)",
            [m.name, m.checksum, db.dialect.t(datetime.now(timezone.utc))],
        )
        ran.append(m.name)
    return ran


def _sqlite_script(q: Database | Tx, sql: str) -> None:
    """Runs a file of statements inside the open transaction (executescript would commit it)."""
    import sqlite3

    buffer = ""
    for line in sql.splitlines(keepends=True):
        buffer += line
        if sqlite3.complete_statement(buffer):
            if buffer.strip():
                q.execute(buffer)
            buffer = ""
    if buffer.strip():
        q.execute(buffer)
