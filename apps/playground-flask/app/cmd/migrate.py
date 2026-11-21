"""Applies the SQL migrations in db/migrations (or creates the MongoDB indexes).

    DATABASE_URL=... python -m app.cmd.migrate status
    DATABASE_URL=... python -m app.cmd.migrate up

It never runs at application startup (DATA-MODEL-003). Read a new migration before you apply it;
there is no automatic rollback, so take a backup first.
"""

from __future__ import annotations

import argparse
import os
import sys

from .. import env_file, store
from ..config import Config
from ..store.errors import DatabaseError
from ..wsgi import config_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cmd.migrate")
    parser.add_argument("command", choices=["status", "up"])
    parser.add_argument("--dir", default="db/migrations", help="directory of migrations")
    args = parser.parse_args(argv)
    env_file.load()
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 1
    try:
        database = Config.load(config_path()).adapter.database
        if args.command == "status":
            applied, pending = store.migration_status(database, url, args.dir)
            # The same format as the Go runner, which `selfauth db` reads: names separated by spaces.
            print(f"applied: [{' '.join(applied)}]\npending: [{' '.join(pending)}]")
            return 0
        if os.environ.get("APP_ENV") == "production":
            print("Production database: make sure a recent backup exists.")
        ran = store.migrate(database, url, args.dir)
    except (DatabaseError, ValueError, OSError) as error:
        print(error, file=sys.stderr)
        return 1
    except Exception as error:  # noqa: BLE001 - config errors and driver errors read better than a trace
        print(error, file=sys.stderr)
        return 1
    print(f"Applied: [{' '.join(ran)}]" if ran else "No pending migrations.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
