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
