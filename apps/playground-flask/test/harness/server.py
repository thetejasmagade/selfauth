"""The Python side of the SelfAuth conformance driver (conformance/CONFORMANCE.md). It is test-only
and is not part of the server.

The conformance runner is written in TypeScript and drives an application over HTTP. This program
hosts one isolated application instance per conformance case, each with its own store, manual
clock, mailer and log sink, and exposes control endpoints for the views a case needs but a real
client does not have: time, the last email, storage, security events and logs.

    POST   /__control/instances                  create an instance (store, config, environment, given)
    DELETE /__control/instances/{id}             close it
    POST   /__control/instances/{id}/advance     {"ms": n}
    GET    /__control/instances/{id}/email?to=   the last email to an address
    GET    /__control/instances/{id}/storage?entity=
    POST   /__control/instances/{id}/mutate      {"entity", "where", "set"}
    GET    /__control/instances/{id}/events
    GET    /__control/instances/{id}/logs
    GET    /__control/instances/{id}/list-filtered
    ANY    /i/{id}/...                           the application itself
"""

from __future__ import annotations

import json
import os
import sys
import threading
from datetime import timedelta
from typing import Any, Callable, Iterable
from urllib.parse import parse_qs, unquote

from flask import Flask, jsonify
from werkzeug.serving import WSGIRequestHandler, make_server

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.auth import authz, errors  # noqa: E402
from app.auth.authz import Resource, ownership_policy, role_definitions  # noqa: E402
from app.auth.clock import ManualClock  # noqa: E402
from app.auth.crypto import new_id  # noqa: E402
from app.auth.logger import Logger, MemoryLogSink  # noqa: E402
from app.auth.mailer import MemoryMailer  # noqa: E402
from app.auth.email import normalize_email  # noqa: E402
from app.auth.password import PasswordHasher  # noqa: E402
from app.auth.store import ACTIVE, DELETED, PENDING, UserPatch, UserRecord  # noqa: E402
from app.config import Config, Env  # noqa: E402
from app.factory import build_auth, create_app  # noqa: E402
from app.flask_auth import Auth  # noqa: E402
from test.harness.backends import Backend, MemoryBackend  # noqa: E402

BASE_URL = "https://app.example.test"
TEST_CSRF_SECRET = bytes([7]) * 32


class Instance:
    def __init__(self, app: Flask, clock: ManualClock, mailer: MemoryMailer, backend: Backend, logs: MemoryLogSink) -> None:
        self.app = app
        self.clock = clock
        self.mailer = mailer
        self.backend = backend
        self.logs = logs
        self.lock = threading.Lock()
        self.resources: list[Resource] = []
        self.list_filtered: bool | None = None
        self.fixtures: dict[str, dict[str, str]] = {}


class Harness:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.instances: dict[str, Instance] = {}
        self._hashes: dict[str, str] = {}
        self._hash_lock = threading.Lock()

    # ── building an instance ──

    def _hash(self, hasher: PasswordHasher, params: Any, password: str) -> str:
        key = f"{params.memory_kib}/{params.iterations}/{params.parallelism}/{password}"
        with self._hash_lock:
            if key not in self._hashes:
                self._hashes[key] = hasher.hash(password)
            return self._hashes[key]

    def _backend(self, store: str) -> Backend:
        if store in ("", "memory"):
            return MemoryBackend()
        from test.harness.sqlbackend import make_backend  # imported on demand: needs a database

        return make_backend(store)

    def build(self, request: dict[str, Any]) -> tuple[str, Instance]:
        config = Config.parse(json.dumps(request["config"]))
        env = Env(app_env="production" if request.get("environment") == "production" else "test",
                  app_base_url=BASE_URL, csrf_secret=TEST_CSRF_SECRET)
        clock, mailer, logs = ManualClock(), MemoryMailer(), MemoryLogSink()
        backend = self._backend(request.get("store", ""))
        built = False
        try:
            store = backend.store
            logger = Logger(logs)
            store.sync_roles(role_definitions(config))
            auth = build_auth(config, env, store, mailer, backend.rate_limit_store, logger, clock)
            instance = Instance(None, clock, mailer, backend, logs)  # type: ignore[arg-type]

            # Fixtures are written directly to storage, as a seed script would.
            hasher = PasswordHasher(config.authentication.password.hashing)
            given = request.get("given") or []
            for item in given:
                if item.get("resource"):
                    continue
                now = clock.now()
                state = item.get("state") or ACTIVE
                roles = item["roles"] if item.get("roles") is not None else config.authorization.default_roles
                email = item["email"]
                user = UserRecord(
                    id=new_id(), email=email, email_normalized=normalize_email(email),
                    state=ACTIVE if state == DELETED else state, created_at=now, updated_at=now,
                    email_verified_at=None if state == PENDING else now,
                )
                created = store.create_user(user, self._hash(hasher, config.authentication.password.hashing, item["password"]), list(roles))
                if state == DELETED:
                    store.update_user(created.id, UserPatch(state=DELETED, deleted_at=now, clear_email=True))
                    store.delete_credentials(created.id)
                instance.fixtures[item["user"]] = {"id": created.id}
            for item in given:
                resource = item.get("resource")
                if not resource:
                    continue
                owner = instance.fixtures.get(resource["owner"])
                if owner is None:
                    raise ValueError(f"resource owner {resource['owner']!r} is not a fixture user")
                instance.resources.append(Resource(resource["type"], resource["id"], owner["id"]))
                instance.fixtures[resource["id"]] = {"id": resource["id"]}

            instance.app = create_app(config, auth, mount=lambda app, a: mount(instance, app, a, config))
            built = True
            return new_id(), instance
        finally:
            if not built:
                backend.close()

    # ── WSGI ──

    def __call__(self, environ: dict[str, Any], start_response: Callable[..., Any]) -> Iterable[bytes]:
        path = environ.get("PATH_INFO", "")
        if path.startswith("/i/"):
            instance_id, _, rest = path[len("/i/"):].partition("/")
            with self.lock:
                instance = self.instances.get(instance_id)
            if instance is None:
                return _text(start_response, 404, "not found")
            environ = dict(environ)
            environ["PATH_INFO"] = "/" + rest
            return instance.app.wsgi_app(environ, start_response)
        if path.startswith("/__control/"):
            return self.control(environ, start_response)
        return _text(start_response, 404, "not found")

    def control(self, environ: dict[str, Any], start_response: Callable[..., Any]) -> Iterable[bytes]:
        method = environ["REQUEST_METHOD"]
        parts = environ["PATH_INFO"][len("/__control/"):].split("/")
        query = parse_qs(environ.get("QUERY_STRING", ""))
        length = int(environ.get("CONTENT_LENGTH") or 0)
        if length:
            raw = environ["wsgi.input"].read(length)
        elif environ.get("wsgi.input_terminated"):
            raw = environ["wsgi.input"].read()  # a chunked body: the server ends the stream
        else:
            raw = b""
        try:
            body = json.loads(raw) if raw else {}
        except ValueError as exc:
            return _json(start_response, 400, {"error": str(exc)})

        if parts == ["instances"] and method == "POST":
            try:
                instance_id, instance = self.build(body)
            except Exception as exc:  # noqa: BLE001 - reported to the driver
                return _json(start_response, 400, {"error": f"{type(exc).__name__}: {exc}"})
            with self.lock:
                self.instances[instance_id] = instance
            return _json(start_response, 200, {"id": instance_id, "fixtures": instance.fixtures})
        if len(parts) < 2 or parts[0] != "instances":
            return _text(start_response, 404, "not found")
        with self.lock:
            instance = self.instances.get(parts[1])
        if instance is None:
            return _text(start_response, 404, "not found")
        action = parts[2] if len(parts) > 2 else ""
        try:
            if action == "" and method == "DELETE":
                with self.lock:
                    self.instances.pop(parts[1], None)
                instance.backend.close()
                return _json(start_response, 200, {"closed": True})
            if action == "advance" and method == "POST":
                instance.clock.advance(timedelta(milliseconds=int(body.get("ms", 0))))
                return _json(start_response, 200, {"ok": True})
            if action == "email":
                mail = instance.mailer.last_to(unquote(query.get("to", [""])[0]))
                if mail is None:
                    return _json(start_response, 200, None)
                out: dict[str, Any] = {"kind": mail.kind}
                if mail.token:
                    out["token"] = mail.token
                if mail.link:
                    out["link"] = mail.link
                return _json(start_response, 200, out)
            if action == "storage":
                return _json(start_response, 200, instance.backend.inspect(query.get("entity", [""])[0]))
            if action == "mutate" and method == "POST":
                instance.backend.mutate(body.get("entity", ""), body.get("where") or {}, body.get("set") or {})
                return _json(start_response, 200, {"ok": True})
            if action == "events":
                return _json(start_response, 200, instance.backend.events())
            if action == "logs":
                return _json(start_response, 200, instance.logs.lines())
            if action == "list-filtered":
                with instance.lock:
                    return _json(start_response, 200, {"filtered": instance.list_filtered})
        except Exception as exc:  # noqa: BLE001 - reported to the driver
            return _json(start_response, 400, {"error": f"{type(exc).__name__}: {exc}"})
        return _text(start_response, 404, "not found")


def _text(start_response: Callable[..., Any], status: int, text: str) -> list[bytes]:
    data = text.encode()
    start_response(f"{status} X", [("Content-Type", "text/plain"), ("Content-Length", str(len(data)))])
    return [data]


def _json(start_response: Callable[..., Any], status: int, value: Any) -> list[bytes]:
    data = json.dumps(value).encode()
    start_response(f"{status} X", [("Content-Type", "application/json"), ("Content-Length", str(len(data)))])
    return [data]


def mount(instance: Instance, app: Flask, auth: Auth, config: Config) -> None:
    """Adds the harness routes every conformance driver provides."""
    routes = auth.protected(app, "/__conformance")

    def ok(**_: Any) -> Any:
        return jsonify({"ok": True})

    for permission in sorted(authz.known_permissions(config)):
        routes.post("/permission/" + permission, auth.require_permission(permission))(ok)
        routes.post(
            "/resource/" + permission + "/<type>/<id>",
            auth.authorize_resource(permission, lambda kw: kw["type"], lambda kw: kw["id"]),
        )(ok)
    routes.post("/unconfigured")(ok)  # no guard: must be denied (AUTHZ-CORE-001)

    if "orders.view" in authz.known_permissions(config):

        @routes.get("/list/order", auth.require_permission("orders.view"))
        def list_orders() -> Any:
            session = auth.context()
            assert session is not None
            owner_id, everyone, _ = authz.owner_filter(session.subject, "orders.view")
            with instance.lock:
                instance.list_filtered = not everyone
                # The filter is applied by the query, not after loading everything (AUTHZ-RES-006).
                ids = [r.id for r in instance.resources if r.type == "order" and (everyone or r.owner_id == owner_id)]
            return jsonify({"ids": ids})

    def load_order(resource_id: str) -> Resource | None:
        with instance.lock:
            return next((r for r in instance.resources if r.type == "order" and r.id == resource_id), None)

    auth.policies.register("order", ownership_policy(load_order))

    @app.get("/__conformance/fault")
    def fault() -> Any:
        raise RuntimeError("SELECT * FROM auth_users failed at db.go:12:3")


def main() -> None:
    harness = Harness()
    WSGIRequestHandler.protocol_version = "HTTP/1.1"
    WSGIRequestHandler.log_request = lambda *a, **k: None  # type: ignore[method-assign]
    server = make_server("127.0.0.1", 0, harness, threaded=True)
    sys.stdout.write(f"listening 127.0.0.1:{server.server_port}\n")
    sys.stdout.flush()
    server.serve_forever()


if __name__ == "__main__":
    main()
