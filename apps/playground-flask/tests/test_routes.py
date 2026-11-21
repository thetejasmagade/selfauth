"""Your own routes: the example route is guarded by authentication."""

from __future__ import annotations

from tests.conftest import Harness

PASSWORD = "correct horse battery staple"


def test_hello_requires_authentication(harness: Harness) -> None:
    response = harness.client.get("/api/hello")
    assert response.status_code == 401
    assert response.get_json()["error"]["code"] == "UNAUTHENTICATED"


def test_hello_greets_the_signed_in_user(harness: Harness) -> None:
    harness.post("/auth/register", {"email": "maya@example.com", "password": PASSWORD})
    response = harness.client.get("/api/hello")
    assert response.status_code == 200
    assert response.get_json() == {"hello": "maya@example.com", "database": "in-memory"}
