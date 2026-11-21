from __future__ import annotations

import os

from app import env_file


def test_loads_values_without_overriding_the_real_environment(tmp_path, monkeypatch) -> None:
    file = tmp_path / ".env"
    file.write_text('# comment\nPORT=4000\nexport NAME="Notes App"\nQUOTED=\'x y\'\nTRAILING=value # note\n\nKEPT=file\n')
    monkeypatch.delenv("PORT", raising=False)
    monkeypatch.delenv("NAME", raising=False)
    monkeypatch.delenv("QUOTED", raising=False)
    monkeypatch.delenv("TRAILING", raising=False)
    monkeypatch.setenv("KEPT", "real")
    loaded = env_file.load(str(file))
    assert sorted(loaded) == ["NAME", "PORT", "QUOTED", "TRAILING"]
    assert os.environ["PORT"] == "4000"
    assert os.environ["NAME"] == "Notes App"
    assert os.environ["QUOTED"] == "x y"
    assert os.environ["TRAILING"] == "value"
    assert os.environ["KEPT"] == "real"
    for name in loaded:
        monkeypatch.delenv(name)


def test_a_missing_file_is_fine(tmp_path) -> None:
    assert env_file.load(str(tmp_path / "nope")) == []
