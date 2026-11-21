"""The migration runner and the schema (SQL databases): applied once, idempotent, strict about edits,
safe next to your own tables."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

pytest.importorskip("app.store.migrations")

from app.store import migrations  # noqa: E402
from app.store.dialect import Database  # noqa: E402
from app.store.errors import DatabaseError  # noqa: E402
from tests.support import migrations_dir  # noqa: E402


@pytest.fixture
def sqlite_url(tmp_path):
    return f"file:{tmp_path}/app.db"


@pytest.fixture
def schema(tmp_path) -> list[migrations.Migration]:
    directory = migrations_dir("sqlite")
    if directory is None:
        pytest.skip("no SQLite migrations here")
    copy = tmp_path / "migrations"
    shutil.copytree(directory, copy)
    return migrations.load(copy)


def test_migrations_apply_once_and_are_idempotent(sqlite_url, schema) -> None:
    """DATA-MODEL-003."""
    assert migrations.migrate(sqlite_url, schema) == [m.name for m in schema]
    assert migrations.migrate(sqlite_url, schema) == []
    status = migrations.status(sqlite_url, schema)
    assert status.pending == [] and status.applied == [m.name for m in schema]


def test_status_changes_nothing(sqlite_url, schema) -> None:
    assert migrations.status(sqlite_url, schema).pending == [m.name for m in schema]
    assert migrations.status(sqlite_url, schema).pending == [m.name for m in schema]


def test_an_applied_migration_that_was_edited_is_refused(sqlite_url, schema, tmp_path) -> None:
    migrations.migrate(sqlite_url, schema)
    first = tmp_path / "migrations" / schema[0].name / "migration.sql"
    first.write_text(first.read_text() + "\n-- edited\n")
    with pytest.raises(DatabaseError, match="edited"):
        migrations.migrate(sqlite_url, migrations.load(tmp_path / "migrations"))


def test_the_database_cannot_know_a_migration_the_project_does_not(sqlite_url, schema, tmp_path) -> None:
    migrations.migrate(sqlite_url, schema)
    shutil.rmtree(tmp_path / "migrations" / schema[0].name)
    with pytest.raises(DatabaseError, match="not in the migrations directory"):
        migrations.migrate(sqlite_url, migrations.load(tmp_path / "migrations"))


def test_your_own_tables_and_rows_are_untouched(sqlite_url, schema) -> None:
    """DATA-MODEL-004: the schema only creates auth_ tables, and an existing table keeps its rows."""
    db = Database(sqlite_url)
    db.execute("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)")
    db.execute("INSERT INTO notes (body) VALUES ('keep me')")
    db.close()
    migrations.migrate(sqlite_url, schema)
    db = Database(sqlite_url)
    assert db.query("SELECT body FROM notes") == [("keep me",)]
    tables = {r[0] for r in db.query("SELECT name FROM sqlite_master WHERE type = 'table'")}
    db.close()
    assert {t for t in tables if t.startswith("auth_")} >= {"auth_users", "auth_sessions", "auth_rate_limits"}
    assert tables - {t for t in tables if t.startswith("auth_")} == {"notes", "selfauth_migrations"}


def test_unique_indexes_exist_on_a_fresh_database(sqlite_url, schema) -> None:
    """DATA-MODEL-001."""
    migrations.migrate(sqlite_url, schema)
    db = Database(sqlite_url)
    names = {r[0] for r in db.query("SELECT name FROM sqlite_master WHERE type = 'index'")}
    db.close()
    for wanted in ("auth_users_email_normalized_key", "auth_sessions_token_hash_key"):
        assert wanted in names


def test_a_failing_migration_changes_nothing_on_sqlite(sqlite_url, tmp_path) -> None:
    directory = tmp_path / "bad" / "20260101000000_bad"
    directory.mkdir(parents=True)
    (directory / "migration.sql").write_text("CREATE TABLE ok (id INTEGER);\nCREATE TABLE ok (id INTEGER);\n")
    with pytest.raises(DatabaseError, match="20260101000000_bad"):
        migrations.migrate(sqlite_url, migrations.load(tmp_path / "bad"))
    db = Database(sqlite_url)
    assert db.query("SELECT name FROM sqlite_master WHERE name = 'ok'") == []
    db.close()
