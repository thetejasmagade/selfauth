"""Shared test setup: a configuration with fast hashing, a memory store and a client."""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Callable

import pytest

from app import routes
from app.auth.authz import role_definitions
from app.auth.mailer import MemoryMailer
from app.config import Config, Env, Hashing
from app.factory import build_auth, create_app
from app.store import DB
from app.store.memory import MemoryStore

DEFAULT = Path(__file__).parent / "testdata" / "default.json"


def make_config(edit: Callable[[Config], None] | None = None) -> Config:
    config = Config.parse(DEFAULT.read_bytes())
    config.authentication.password.hashing = Hashing(memory_kib=64, iterations=1, parallelism=1)
    config.authentication.email_verification.mode = "off"  # accounts are usable right after registration
    config.authentication.registration.sign_in_after_registration = True
    if edit is not None:
        edit(config)
    return config


class Harness:
    def __init__(self, config: Config, app_env: str = "test") -> None:
        secret = base64.urlsafe_b64encode(b"s" * 32).decode().rstrip("=")
        env = Env(
            app_env=app_env, app_base_url="https://app.example.test",
            csrf_secret=base64.urlsafe_b64decode(secret + "=" * (-len(secret) % 4)),
        )
        self.store = MemoryStore()
        self.store.sync_roles(role_definitions(config))
        self.mailer = MemoryMailer()
        self.auth = build_auth(config, env, self.store, self.mailer)
        self.app = create_app(config, self.auth, mount=lambda a, au: routes.register(a, au, DB()))
        self.client = self.app.test_client()
        self.config = config

    def post(self, path: str, body: dict, **headers: str):
        headers = {"X-SelfAuth-CSRF": "1", **headers}
        return self.client.post(path, data=json.dumps(body), content_type="application/json", headers=headers)


@pytest.fixture
def harness() -> Harness:
    return Harness(make_config())
