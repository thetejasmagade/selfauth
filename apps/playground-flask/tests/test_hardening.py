"""Start-up refusals, secrets, redirects and guards of the Flask binding."""

from __future__ import annotations

import base64
import json

import pytest

from app import routes
from app.auth.mailer import MemoryMailer
from app.config import Config, ConfigError, Env, load_env
from app.factory import build_auth, create_app
from app.store import DB
from app.store.memory import MemoryStore
from tests.conftest import DEFAULT, Harness, make_config

PASSWORD = "correct horse battery staple"


def env(**overrides: object) -> Env:
    values = {"app_env": "test", "app_base_url": "https://app.example.test", **overrides}
    return Env(**values)  # type: ignore[arg-type]


def test_production_refuses_an_insecure_session_cookie() -> None:
    """SEC-COOKIE-003: insecure cookies only outside production."""
    config = make_config(lambda c: setattr(c.authentication.sessions.cookie, "secure", False) or
                         setattr(c.authentication.sessions.cookie, "name", "session"))
    with pytest.raises(ValueError, match="cookie.secure"):
        build_auth(config, env(app_env="production"), MemoryStore(), MemoryMailer())
    build_auth(config, env(app_env="test"), MemoryStore(), MemoryMailer())  # allowed outside production


def test_production_refuses_an_http_base_url() -> None:
    with pytest.raises(ValueError, match="https"):
        build_auth(make_config(), env(app_env="production", app_base_url="http://app.example.test"), MemoryStore(), MemoryMailer())


def test_startup_needs_a_valid_base_url() -> None:
    """SEC-SECRET-003: the environment fails fast instead of starting half-configured."""
    with pytest.raises(Exception, match="SELFAUTH_APP_BASE_URL"):
        load_env({"APP_ENV": "development"}.get)
    assert load_env({"APP_ENV": "development", "SELFAUTH_APP_BASE_URL": "http://localhost:5173"}.get).port == 3000


def test_token_mode_csrf_needs_a_secret_of_at_least_32_bytes() -> None:
    """SEC-SECRET-003 / SEC-SECRET-004."""
    config = make_config(lambda c: setattr(c.http.csrf, "mode", "token"))
    with pytest.raises(ValueError, match="32 bytes"):
        build_auth(config, env(csrf_secret=b"short"), MemoryStore(), MemoryMailer())
    short = base64.urlsafe_b64encode(b"s" * 16).decode().rstrip("=")
    with pytest.raises(Exception, match="SELFAUTH_CSRF_SECRET"):
        load_env({"APP_ENV": "test", "SELFAUTH_APP_BASE_URL": "https://a.test", "SELFAUTH_CSRF_SECRET": short}.get)


def _token_harness(secret: bytes, previous: bytes | None = None) -> Harness:
    h = Harness.__new__(Harness)
    config = make_config(lambda c: setattr(c.http.csrf, "mode", "token"))
    h.config, h.store, h.mailer = config, MemoryStore(), MemoryMailer()
    from app.auth.authz import role_definitions

    h.store.sync_roles(role_definitions(config))
    h.auth = build_auth(config, env(csrf_secret=secret, csrf_secret_previous=previous), h.store, h.mailer)
    h.app = create_app(config, h.auth, mount=lambda a, au: routes.register(a, au, DB()))
    h.client = h.app.test_client()
    return h


def _csrf_token(h: Harness) -> str:
    response = h.post(
        "/auth/register", {"email": "maya@example.com", "password": PASSWORD}, Origin="https://app.example.test"
    )
    return response.get_json()["csrfToken"]


def test_a_token_signed_with_the_previous_secret_is_still_accepted() -> None:
    """SEC-SECRET-004: rotation keeps sessions alive until the old secret is dropped."""
    old, new = b"o" * 32, b"n" * 32
    first = _token_harness(old)
    token = _csrf_token(first)
    rotated = _token_harness(new, previous=old)
    rotated.store, rotated.auth.service.d.store = first.store, first.store
    rotated.client.set_cookie(first.config.authentication.sessions.cookie.name, first.client.get_cookie(first.config.authentication.sessions.cookie.name).value)
    ok = rotated.client.post("/auth/logout-all", headers={"X-SelfAuth-CSRF": token})
    assert ok.status_code == 204


def test_a_token_signed_with_a_dropped_secret_is_refused() -> None:
    first = _token_harness(b"o" * 32)
    token = _csrf_token(first)
    dropped = _token_harness(b"n" * 32)
    dropped.auth.service.d.store = first.store
    dropped.client.set_cookie(first.config.authentication.sessions.cookie.name, first.client.get_cookie(first.config.authentication.sessions.cookie.name).value)
    refused = dropped.client.post("/auth/logout-all", headers={"X-SelfAuth-CSRF": token})
    assert refused.status_code == 403


def test_nothing_ever_redirects(harness: Harness) -> None:
    """SEC-REDIRECT-001: no response is a redirect, whatever the path or parameters say."""
    paths = ["/auth/me/", "//evil.example", "/auth/me?next=https://evil.example", "/api//hello", "/health/", "/%2e%2e/auth/me"]
    for path in paths:
        response = harness.client.get(path, headers={"Referer": "https://evil.example"})
        assert response.status_code < 300 or response.status_code >= 400, path
        assert "Location" not in response.headers, path
    for path in paths[:2]:
        response = harness.post(path, {"next": "https://evil.example", "redirect": "https://evil.example"})
        assert "Location" not in response.headers


def test_a_permission_that_is_not_configured_fails_when_the_route_is_defined(harness: Harness) -> None:
    """AUTHZ-PERM-004: a typo in a permission name is an error at start-up, not a silent allow."""
    with pytest.raises(ValueError):
        harness.auth.require_permission("orders.nope")


def test_routes_on_a_protected_group_are_denied_unless_a_guard_allows_them(harness: Harness) -> None:
    """AUTHZ-CORE-002."""
    harness = Harness(
        make_config(
            lambda c: (
                c.authorization.permissions.append("orders.view"),
                c.authorization.roles["user"].append("orders.view"),
            )
        )
    )
    group = harness.auth.protected(harness.app, "/guarded")

    @group.get("/open")
    def unguarded():  # no guard: the group denies it
        return "never"

    @group.get("/in", harness.auth.require_permission("orders.view"))
    def guarded():
        return "in"

    assert harness.client.get("/guarded/open").status_code in (401, 403)
    assert harness.client.get("/guarded/in").status_code == 401
    harness.post("/auth/register", {"email": "maya@example.com", "password": PASSWORD})
    assert harness.client.get("/guarded/open").status_code in (401, 403)
    assert harness.client.get("/guarded/in").status_code == 200


def test_the_configuration_has_no_field_for_a_secret() -> None:
    """SEC-SECRET-001 / CONF-FILE-002: configuration is behavior only."""
    data = json.loads(DEFAULT.read_bytes())

    def keys(node: object, out: set[str]) -> set[str]:
        if isinstance(node, dict):
            for k, v in node.items():
                out.add(k.lower())
                keys(v, out)
        return out

    assert not [k for k in keys(data, set()) if any(w in k for w in ("secret", "password" + "hash", "apikey", "token" + "value"))]
    data["http"]["csrfSecret"] = "x" * 32
    with pytest.raises(ConfigError):
        Config.parse(json.dumps(data))


def test_the_options_that_reveal_registered_emails_are_off_by_default() -> None:
    """SEC-ENUM-004."""
    config = Config.parse(DEFAULT.read_bytes())
    assert config.authentication.registration.reveal_existing_email is False
    assert config.authentication.registration.sign_in_after_registration is False


def test_the_store_factory_rejects_a_database_this_project_does_not_have() -> None:
    """CONF-FILE-004."""
    from app import store
    from app.store.errors import DatabaseError

    with pytest.raises(DatabaseError, match="not built into this project"):
        store.connect("oracle", "oracle://x")
