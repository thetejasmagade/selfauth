"""Builds the application from the environment. `app` is the WSGI callable: any WSGI server runs it
(`python -m app.cmd.server`, `waitress-serve app.wsgi:app`, `gunicorn app.wsgi:app`)."""

from __future__ import annotations

import os

from flask import Flask

from . import env_file, routes, store
from .auth.logger import Logger
from .config import Config, load_env
from .factory import build_auth, create_app
from .mailer import create_mailer


def config_path() -> str:
    """The resolved SelfAuth configuration file; behavior only, never secrets."""
    return os.environ.get("SELFAUTH_CONFIG") or "selfauth.config.json"


def build() -> tuple[Flask, store.Stores]:
    env_file.load()  # development: variables from .env (the real environment wins)
    env = load_env()
    config = Config.load(config_path())
    # Plain-http local development cannot use Secure or __Host- cookies.
    if not env.production:
        config.local_development()
    mailer = create_mailer(env)
    stores = store.new(config, env)
    try:
        logger = Logger()
        auth = build_auth(config, env, stores.store, mailer, stores.rate_limit_store, logger)
        app = create_app(config, auth, mount=lambda a, au: routes.register(a, au, stores.db))
    except BaseException:
        stores.close()
        raise
    return app, stores


def __getattr__(name: str) -> object:  # `app` is built on first use, so importing the module is cheap
    if name == "app":
        global _app, _stores
        if _app is None:
            _app, _stores = build()
        return _app
    raise AttributeError(name)


_app: Flask | None = None
_stores: store.Stores | None = None
