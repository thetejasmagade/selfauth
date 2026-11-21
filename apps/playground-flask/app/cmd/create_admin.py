"""Grants the admin role to an existing, active account. The first administrator can only be created
by a developer-run command like this one, never through the API (AUTHZ-ADMIN-005):

    DATABASE_URL=... python -m app.cmd.create_admin you@example.com
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

from .. import env_file, store
from ..auth import authz, email
from ..auth.crypto import new_id
from ..auth.store import ACTIVE, EventRecord
from ..config import Config
from ..wsgi import config_path


def main(argv: list[str] | None = None) -> int:
    env_file.load()
    args = sys.argv[1:] if argv is None else argv
    url = os.environ.get("DATABASE_URL")
    if not url or len(args) != 1:
        print("usage: DATABASE_URL=... python -m app.cmd.create_admin <email>", file=sys.stderr)
        return 1
    address = args[0]
    try:
        config = Config.load(config_path())
        stores = store.connect(config.adapter.database, url)
        try:
            db = stores.store
            user = db.find_user_by_email(email.normalize_email(address))
            if user is None or user.state != ACTIVE:
                print("no active account with that email: register and verify it first", file=sys.stderr)
                return 1
            if not db.role_exists(authz.ADMIN_ROLE):
                print("the admin role does not exist yet: run the seed command first", file=sys.stderr)
                return 1
            now = datetime.now(timezone.utc).replace(microsecond=(datetime.now(timezone.utc).microsecond // 1000) * 1000)
            db.add_user_role(user.id, authz.ADMIN_ROLE, None, now)
            db.record_event(
                EventRecord(
                    id=new_id(), type="role.assigned", outcome="success", occurred_at=now, user_id=user.id,
                    user_agent="selfauth create-admin", metadata={"role": "admin", "via": "cli"},
                )
            )
        finally:
            stores.close()
    except Exception as error:  # noqa: BLE001
        print(error, file=sys.stderr)
        return 1
    print(f"{address} is now an administrator.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
