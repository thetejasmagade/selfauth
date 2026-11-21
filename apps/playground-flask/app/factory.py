"""Wires the configuration, the SelfAuth core and Flask."""

from __future__ import annotations

from typing import Callable

from flask import Flask, Response, jsonify

from . import httpx
from .auth import errors
from .auth.authz import PolicyRegistry
from .auth.clock import Clock, SystemClock
from .auth.logger import Logger
from .auth.mailer import Mailer
from .auth.password import PasswordHasher
from .auth.ratelimit import MemoryRateLimitStore, RateLimiter, RateLimitStore
from .auth.service import Deps, Service
from .auth.store import Store
from .config import Config, Env
from .flask_auth import Auth


def build_auth(
    config: Config,
    env: Env,
    store: Store,
    mailer: Mailer,
    rate_limit_store: RateLimitStore | None = None,
    logger: Logger | None = None,
    clock: Clock | None = None,
) -> Auth:
    """Builds the authentication service and its Flask adapter, refusing unsafe production settings."""
    # SEC-COOKIE-003: insecure cookies only outside production.
    if env.production and not config.authentication.sessions.cookie.secure:
        raise ValueError("authentication.sessions.cookie.secure must be true in production")
    if env.production and not env.app_base_url.startswith("https://"):
        raise ValueError("the application base URL must use https in production (SEC-HTTP-002)")
    clock = clock or SystemClock()
    service = Service(
        Deps(
            config=config, store=store, mailer=mailer, clock=clock,
            hasher=PasswordHasher(config.authentication.password.hashing),
            limiter=RateLimiter(rate_limit_store or MemoryRateLimitStore(), clock),
            app_base_url=env.app_base_url,
        )
    )
    return Auth(
        config, service, PolicyRegistry(), clock, logger, env.app_base_url,
        csrf_secret=env.csrf_secret, csrf_secret_previous=env.csrf_secret_previous,
    )


def create_app(
    config: Config,
    auth: Auth,
    logger: Logger | None = None,
    mount: Callable[[Flask, Auth], None] | None = None,
) -> Flask:
    """Builds the Flask app: request id, logging, the JSON body limit, then SelfAuth's CORS,
    session and CSRF hooks and routes, then yours."""
    app = Flask(__name__)
    app.url_map.strict_slashes = True
    app.config["PROPAGATE_EXCEPTIONS"] = False
    auth.install(app)

    @app.get("/health")
    def health() -> Response:
        return jsonify({"status": "ok"})

    if mount is not None:
        mount(app, auth)
    return app
