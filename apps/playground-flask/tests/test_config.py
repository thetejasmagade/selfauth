"""The configuration is strict: a typo or an out-of-range value stops the server from starting."""

from __future__ import annotations

import json

import pytest

from app.config import Config, ConfigError
from tests.conftest import DEFAULT


def test_the_default_configuration_is_valid() -> None:
    config = Config.parse(DEFAULT.read_bytes())
    assert config.authentication.password.min_length == 8
    assert config.http.base_path == "/auth"


@pytest.mark.parametrize("frontend", ["none", "vue", "react", "next"])
def test_every_frontend_the_cli_can_generate_is_accepted(frontend: str) -> None:
    """`selfauth init --backend flask --frontend next` writes this value into the configuration."""
    data = json.loads(DEFAULT.read_bytes())
    data["adapter"]["frontend"] = frontend
    assert Config.parse(json.dumps(data)).adapter.frontend == frontend


def test_an_unknown_frontend_is_rejected() -> None:
    data = json.loads(DEFAULT.read_bytes())
    data["adapter"]["frontend"] = "svelte"
    with pytest.raises(ConfigError):
        Config.parse(json.dumps(data))


def test_an_unknown_field_is_rejected() -> None:
    data = json.loads(DEFAULT.read_bytes())
    data["authentication"]["password"]["minLenght"] = 3
    with pytest.raises(ConfigError):
        Config.parse(json.dumps(data))


def test_a_password_minimum_below_eight_is_rejected() -> None:
    data = json.loads(DEFAULT.read_bytes())
    data["authentication"]["password"]["minLength"] = 4
    with pytest.raises(ConfigError):
        Config.parse(json.dumps(data))


def _change(edit) -> str:
    data = json.loads(DEFAULT.read_bytes())
    edit(data)
    return json.dumps(data)


@pytest.mark.parametrize(
    ("what", "edit"),
    [
        ("a malformed permission name", lambda d: d["authorization"].update(permissions=["Orders-View"])),
        ("the reserved auth. prefix", lambda d: d["authorization"].update(permissions=["auth.custom"])),
        (
            "a role that references an undefined permission",
            lambda d: d["authorization"]["roles"].update(user=["orders.view"]),
        ),
        ("a minLength below 8", lambda d: d["authentication"]["password"].update(minLength=7)),
        ("a password age setting", lambda d: d["authentication"]["password"].update(maxAgeDays=90)),
        ("an unknown top-level key", lambda d: d.update(extra=True)),
        ("a TTL out of range", lambda d: d["authentication"]["passwordReset"].update(tokenTtlMinutes=100000)),
        ("a negative timeout", lambda d: d["authentication"]["sessions"].update(idleTimeoutMinutes=-1)),
        ("an unsupported major specVersion", lambda d: d.update(specVersion="9.0")),
        ("sign-in after registration without revealing emails", lambda d: d["authentication"]["registration"].update(signInAfterRegistration=True)),
    ],
)
def test_the_configuration_rejects(what: str, edit) -> None:
    with pytest.raises(ConfigError):
        Config.parse(_change(edit))
