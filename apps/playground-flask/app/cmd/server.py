"""Runs the application: `python -m app.cmd.server`."""

from __future__ import annotations

import logging
import sys

from ..config import load_env
from ..wsgi import build


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        env = load_env()
        app, stores = build()
    except Exception as error:  # noqa: BLE001 - a startup problem is shown, not a stack trace
        print(error, file=sys.stderr)
        return 1
    from waitress import create_server

    try:
        # Bind first, so "Listening" is only printed once the port is really ours.
        server = create_server(app, host="0.0.0.0", port=env.port, threads=8, ident=None)
    except OSError as error:
        print(f"could not start on port {env.port}: {error}", file=sys.stderr)
        stores.close()
        return 1
    print(f"Listening on http://localhost:{env.port}", flush=True)
    try:
        server.run()
    except KeyboardInterrupt:
        pass
    finally:
        stores.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
