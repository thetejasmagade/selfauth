---
title: "8. Test your endpoints"
description: Write pytest tests for your Flask endpoints against a real temporary SQLite database, check that anonymous users are refused, that users only see their own notes and that only admins read everyone's.
keywords: [pytest, flask test client, test_client, sqlite test, ownership test, permission test]
---

# 8. Test your endpoints

A test makes sure nobody breaks your rules by accident. Your project already has tests in `tests/` (`pytest` runs them with no database). This chapter adds tests for the notes endpoints on a real, temporary SQLite database, so the SQL runs too.

First make the test configuration know the notes permissions. `tests/testdata/default.json` is the configuration the tests read (so they keep working when you edit `selfauth.config.json`). Give it the same `permissions` and `roles` as in chapter 5.

Create `tests/test_notes.py`:

```python
"""The notes endpoints, on a real (temporary) SQLite database."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from app.auth.authz import role_definitions
from app.auth.mailer import MemoryMailer
from app.config import Env
from app.factory import build_auth, create_app
from app.notes import register_notes
from app.store import DB, migrations
from app.store.dialect import Database
from app.store.sqlstore import SqlRateLimitStore, SqlStore
from tests.conftest import make_config

PASSWORD = "correct horse battery staple"


@pytest.fixture
def server(tmp_path):
    url = f"file:{tmp_path}/test.db"
    migrations.migrate(url, migrations.load("db/migrations"))
    database = Database(url)
    store = SqlStore(database)
    config = make_config()
    store.sync_roles(role_definitions(config))
    env = Env(app_env="test", app_base_url="https://app.example.test")
    auth = build_auth(config, env, store, MemoryMailer(), SqlRateLimitStore(database))
    app = create_app(config, auth, mount=lambda a, au: register_notes(a, au, DB(sql=database)))
    yield app, store
    database.close()


def sign_up(app, email: str):
    """A new client signed in as `email` (verification is off in the test configuration)."""
    client = app.test_client()
    client.post(
        "/auth/register", data=json.dumps({"email": email, "password": PASSWORD}),
        content_type="application/json", headers={"X-SelfAuth-CSRF": "1"},
    )
    return client


def post(client, path: str, body: dict):
    return client.post(path, data=json.dumps(body), content_type="application/json", headers={"X-SelfAuth-CSRF": "1"})


def test_anonymous_requests_are_refused(server) -> None:
    app, _ = server
    assert app.test_client().get("/api/notes").status_code == 401


def test_you_see_your_own_notes_and_not_anyone_elses(server) -> None:
    app, _ = server
    maya, sam = sign_up(app, "maya@example.com"), sign_up(app, "sam@example.com")
    note = post(maya, "/api/notes", {"text": "Buy milk"}).get_json()["note"]
    assert [n["text"] for n in maya.get("/api/notes").get_json()["notes"]] == ["Buy milk"]
    assert sam.get("/api/notes").get_json() == {"notes": []}
    assert maya.get(f"/api/notes/{note['id']}").status_code == 200
    assert sam.get(f"/api/notes/{note['id']}").status_code == 404  # not even a hint that it exists


def test_only_admins_read_everyones_notes(server) -> None:
    app, store = server
    maya, sam = sign_up(app, "maya@example.com"), sign_up(app, "sam@example.com")
    post(sam, "/api/notes", {"text": "Sam's note"})
    assert maya.get("/api/admin/notes").status_code == 403
    store.add_user_role(store.find_user_by_email("maya@example.com").id, "admin", None, datetime.now(timezone.utc))
    assert [n["text"] for n in maya.get("/api/admin/notes").get_json()["notes"]] == ["Sam's note"]


def test_a_note_needs_text(server) -> None:
    app, _ = server
    assert post(sign_up(app, "maya@example.com"), "/api/notes", {"text": "  "}).status_code == 400
```

Run them:

```bash
pytest -q
```

```text
............................................                [100%]
```

The `make_config()` helper from `tests/conftest.py` turns email verification off and makes registration sign the user in, so a test needs no email step. It also uses cheap password hashing so tests stay fast.

## Check it worked

Break a rule on purpose: remove the `auth.authorize_resource(...)` guard from `one_note` and run `pytest`. `test_you_see_your_own_notes_and_not_anyone_elses` fails. Put it back.

## If something went wrong

- **`ModuleNotFoundError: No module named 'app'`.** Run `pytest` from the project's root folder (`pytest.ini` puts it on the path).
- **`unknown permission`.** `tests/testdata/default.json` doesn't have the notes permissions yet.
- **`no such table`.** The fixture loads `db/migrations` relative to the current folder: run from the project root.

Next: [Get ready for production](./production)
