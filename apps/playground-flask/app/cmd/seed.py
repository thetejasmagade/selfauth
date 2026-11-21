"""Synchronizes the roles and permissions in selfauth.config.json into the database
(AUTHZ-RBAC-005). Run it after migrating and whenever the configured roles change:

    DATABASE_URL=... python -m app.cmd.seed
"""

from __future__ import annotations

import os
import sys

from .. import store
from ..auth import authz
from ..config import Config
from ..wsgi import config_path


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 1
    try:
        config = Config.load(config_path())
        stores = store.connect(config.adapter.database, url)
        try:
            roles = authz.role_definitions(config)
            stores.store.sync_roles(roles)
        finally:
            stores.close()
    except Exception as error:  # noqa: BLE001
        print(error, file=sys.stderr)
        return 1
    print(f"Synchronized roles: {sorted(roles)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
