"""Where your application's own routes live."""

from __future__ import annotations

from flask import Flask, jsonify

from .flask_auth import Auth
from .store import DB


def register(app: Flask, auth: Auth, db: DB) -> None:
    """Mounts application routes. Examples of the guard styles:

    * `@auth.require_auth`: any signed-in user;
    * `@auth.require_permission("x.y")`: a permission from selfauth.config.json (an unknown
      permission raises when the route is defined);
    * `auth.protected(app, "/api")`: a group that denies every route lacking a guard.

    Route guards run on the server for every request (AUTHZ-CORE-002).

    `db` is the database SelfAuth uses, for your own tables: `db.sql` on PostgreSQL, MySQL and
    SQLite, `db.mongo` on MongoDB. Both are None while the app runs on the in-memory store.
    """

    @app.get("/api/hello")
    @auth.require_auth
    def hello():
        database = "connected" if db.sql is not None or db.mongo is not None else "in-memory"
        return jsonify({"hello": auth.context().user.email, "database": database})
