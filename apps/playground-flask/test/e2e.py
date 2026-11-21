"""The backend for the browser end-to-end tests (apps/e2e). Test-only: it keeps email in memory and
exposes the last message per address at /__e2e/mail so a test can follow links, adds a small notes
module like the other reference backends, and refuses to run unless APP_ENV=test."""

from __future__ import annotations

import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from flask import Flask, jsonify  # noqa: E402

from app import httpx  # noqa: E402
from app.auth import errors  # noqa: E402
from app.auth.authz import Resource, owner_filter, ownership_policy, role_definitions  # noqa: E402
from app.auth.email import normalize_email  # noqa: E402
from app.auth.logger import Logger  # noqa: E402
from app.auth.mailer import MemoryMailer  # noqa: E402
from app.config import Config, load_env  # noqa: E402
from app.factory import build_auth, create_app  # noqa: E402
from app.flask_auth import Auth  # noqa: E402
from app.store.memory import MemoryStore  # noqa: E402


def mount_notes(app: Flask, auth: Auth) -> None:
    lock = threading.Lock()
    notes: dict[str, dict[str, str]] = {}

    def load(note_id: str) -> Resource | None:
        with lock:
            note = notes.get(note_id)
        return None if note is None else Resource("note", note["id"], note["ownerId"])

    auth.policies.register("note", ownership_policy(load))
    group = auth.protected(app, "/api/notes")

    @group.post("", auth.require_permission("notes.create"))
    def create():
        text = httpx.body().get("text")
        if not isinstance(text, str) or not text or len(text) > 2000:
            raise errors.AuthError(errors.VALIDATION_FAILED, "text is required (max 2000 characters).")
        with lock:
            note_id = f"note-{len(notes) + 1}"
            note = {"id": note_id, "ownerId": auth.context().subject.user_id, "text": text}
            notes[note_id] = note
        response = jsonify({"note": note})
        response.status_code = 201
        return response

    @group.get("", auth.require_permission("notes.view"))
    def list_notes():
        owner, everyone, _ = owner_filter(auth.context().subject, "notes.view")
        with lock:
            visible = [n for n in notes.values() if everyone or n["ownerId"] == owner]
        return jsonify({"notes": visible})

    @group.get("/<id>", auth.authorize_resource("notes.view", "note", "id"))
    def get_note(id: str):  # noqa: A002 - the URL parameter name
        with lock:
            return jsonify({"note": notes[id]})


def main() -> int:
    env = load_env()
    if env.app_env != "test":
        print("e2e runs only with APP_ENV=test", file=sys.stderr)
        return 1
    config = Config.load("selfauth.config.json")
    config.local_development()
    # The example notes module the browser spec uses.
    config.authorization.permissions += ["notes.create", "notes.view", "notes.view_any"]
    config.authorization.roles["user"] += ["notes.create", "notes.view"]
    config.authorization.roles["support"] = ["notes.view_any"]
    config.validate()

    store = MemoryStore()
    store.sync_roles(role_definitions(config))
    mailer = MemoryMailer()
    auth = build_auth(config, env, store, mailer, None, Logger())

    def mount(app: Flask, a: Auth) -> None:
        mount_notes(app, a)

        @app.get("/__e2e/mail")
        def mail():
            from flask import request

            message = mailer.last_to(request.args.get("to", ""))
            return jsonify(None if message is None else {"kind": message.kind, "link": message.link or None})

        # Grants a role directly, standing in for `create-admin` in tests.
        @app.post("/__e2e/grant")
        def grant():
            body = httpx.body()
            user = store.find_user_by_email(normalize_email(str(body.get("email", ""))))
            if user is None:
                return "", 404
            store.add_user_role(user.id, str(body.get("role", "")), None, datetime.now(timezone.utc))
            return "", 204

    app = create_app(config, auth, mount=mount)
    from waitress import serve

    print(f"e2e backend on :{env.port}", flush=True)
    serve(app, host="0.0.0.0", port=env.port, threads=8, ident=None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
