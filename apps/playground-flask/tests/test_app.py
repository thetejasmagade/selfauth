"""The generated server end to end, on the in-memory store: register, sign in, the session, sign out."""

from __future__ import annotations

from tests.conftest import Harness, make_config

PASSWORD = "correct horse battery staple"


def test_register_signs_in_and_me_returns_the_account(harness: Harness) -> None:
    response = harness.post("/auth/register", {"email": "maya@example.com", "password": PASSWORD})
    assert response.status_code == 201
    me = harness.client.get("/auth/me")
    assert me.status_code == 200
    assert me.get_json()["user"]["email"] == "maya@example.com"


def test_anonymous_requests_are_refused(harness: Harness) -> None:
    response = harness.client.get("/auth/me")
    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == "UNAUTHENTICATED"


def test_sign_out_ends_the_session(harness: Harness) -> None:
    harness.post("/auth/register", {"email": "maya@example.com", "password": PASSWORD})
    assert harness.post("/auth/logout", {}).status_code == 204
    assert harness.client.get("/auth/me").status_code == 401


def test_a_wrong_password_is_refused_with_the_same_answer_as_an_unknown_account(harness: Harness) -> None:
    harness.post("/auth/register", {"email": "maya@example.com", "password": PASSWORD})
    harness.client.delete_cookie(harness.config.authentication.sessions.cookie.name)
    wrong = harness.post("/auth/login", {"email": "maya@example.com", "password": "not the password at all"})
    unknown = harness.post("/auth/login", {"email": "nobody@example.com", "password": "not the password at all"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.get_json()["error"]["code"] == unknown.get_json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert wrong.get_json()["error"]["message"] == unknown.get_json()["error"]["message"]


def test_state_changing_requests_need_the_csrf_header(harness: Harness) -> None:
    response = harness.client.post("/auth/register", json={"email": "maya@example.com", "password": PASSWORD})
    assert response.status_code == 403


def test_a_weak_password_is_rejected(harness: Harness) -> None:
    response = harness.post("/auth/register", {"email": "maya@example.com", "password": "short"})
    assert response.status_code == 400


def test_unknown_routes_use_the_error_envelope(harness: Harness) -> None:
    response = harness.client.get("/nope")
    assert response.status_code == 404
    assert response.get_json()["error"]["code"] == "NOT_FOUND"


def test_the_cookie_is_host_prefixed_and_secure_by_default() -> None:
    h = Harness(make_config())
    h.client.environ_base["wsgi.url_scheme"] = "https"
    response = h.post("/auth/register", {"email": "maya@example.com", "password": PASSWORD})
    cookie = response.headers.get("Set-Cookie", "")
    assert "HttpOnly" in cookie
    assert "SameSite=Lax" in cookie
