"""Loads a `.env` file into the process environment, for local development.

Variables that are already set win, so the real environment of a server always overrides the file.
It understands `KEY=value`, quotes, comments and blank lines; nothing else.
"""

from __future__ import annotations

import os
from pathlib import Path


def load(path: str = ".env") -> list[str]:
    """Sets the variables of `path` that are not set yet and returns their names. A missing file is fine."""
    file = Path(os.environ.get("SELFAUTH_ENV_FILE") or path)
    try:
        text = file.read_text(encoding="utf-8")
    except OSError:
        return []
    loaded: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip().removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        if name and name not in os.environ:
            os.environ[name] = value
            loaded.append(name)
    return loaded
