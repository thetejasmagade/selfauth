"""The Flask binding of the SelfAuth core: cookies, CORS, the session lookup, CSRF protection, the
/auth routes (AUTHENTICATION_SPEC §11), route guards and deny-by-default protected routes."""

from __future__ import annotations

import functools
import ipaddress
from typing import Any, Callable
from urllib.parse import unquote

from flask import Blueprint, Flask, Response, g, jsonify, request

from . import httpx
from .auth import errors
from .auth.authz import ALLOW, NOT_FOUND, PolicyRegistry, known_permissions
from .auth.clock import Clock
from .auth.crypto import hmac_sha256, safe_equal
from .auth.errors import AuthError, fail
from .auth.logger import Logger
from .auth.service import Context, IssuedSession, RequestContext, Service
from .config import Config, origin_of

_CONTEXT = "selfauth_context"
_AUTHORIZED = "selfauth_authorized"
_PRESENTED = "selfauth_presented_token"
_SAME_SITE = {"strict": "Strict", "none": "None", "lax": "Lax"}


def _truncate(value: str, limit: int) -> str:
    return value if len(value) <= limit else value[:limit]


class Auth:
    """The adapter. Build it with `app.factory.build_auth`, then call `install(app)` once, before
    your own routes."""

    def __init__(
        self,
        config: Config,
        service: Service,
        policies: PolicyRegistry,
        clock: Clock,
        logger: Logger | None,
        app_base_url: str,
        csrf_secret: bytes | None = None,
        csrf_secret_previous: bytes | None = None,
    ) -> None:
        if config.http.csrf.mode == "token" and (csrf_secret is None or len(csrf_secret) < 32):
            raise ValueError("http.csrf.mode 'token' requires a CSRF secret of at least 32 bytes (SEC-SECRET-003)")
        self.config = config
        self.service = service
        self.policies = policies
        self.clock = clock
        self.logger = logger
        self._csrf_secret = csrf_secret
        self._csrf_previous = csrf_secret_previous
        self._trusted = {*config.http.trusted_origins, origin_of(app_base_url)}
        self._known = known_permissions(config)
        self._proxies = _TrustedProxies(config.http.trust_proxy)

    # ── the current request ──

    def context(self) -> Context | None:
        """The validated session context of the current request, or None."""
        return getattr(g, _CONTEXT, None)

    def _request_context(self) -> RequestContext:
        return RequestContext(
            ip_address=_truncate(self._proxies.client_ip(), 64),
            # Stored in bounded columns: an oversized header must not become a database error.
            user_agent=_truncate(request.headers.get("User-Agent", ""), 512),
            request_id=httpx.request_id(),
        )

    # ── installing ──

    def install(self, app: Flask) -> None:
        """Adds the CORS, session and CSRF hooks and the authentication routes at http.basePath."""
        httpx.install(app, self.logger, self.config.http.body_limit_bytes)
        app.before_request(self._cors_preflight)
        app.before_request(self._session)
        app.before_request(self._csrf)
        app.after_request(self._cors_headers)
        app.after_request(self._auth_headers)
        app.register_blueprint(self._blueprint())

    # ── cookies ──

    def _set_session_cookie(self, response: Response, issued: IssuedSession) -> None:
        cookie = self.config.authentication.sessions.cookie
        remaining = int((issued.session.absolute_expires_at - self.clock.now()).total_seconds())
        # Never longer than the absolute session lifetime (SEC-COOKIE-004).
        max_age = min(max(remaining, 0), self.config.authentication.sessions.absolute_timeout_minutes * 60)
        response.set_cookie(
            cookie.name, issued.token, max_age=max_age, path="/", secure=cookie.secure, httponly=True,
            samesite=_SAME_SITE.get(cookie.same_site, "Lax"),
        )

    def _clear_session_cookie(self, response: Response) -> None:
        cookie = self.config.authentication.sessions.cookie
        response.set_cookie(
            cookie.name, "", max_age=0, expires=0, path="/", secure=cookie.secure, httponly=True,
            samesite=_SAME_SITE.get(cookie.same_site, "Lax"),
        )

    # ── CSRF tokens bound to the session (token mode) ──

    def _csrf_token_for(self, session_id: str, key: bytes | None) -> str:
        return hmac_sha256(key, "csrf:" + session_id) if key else ""

    def _with_csrf(self, body: dict[str, Any], session_id: str) -> dict[str, Any]:
        """Merged into responses that start or describe a session."""
        if self.config.http.csrf.mode == "token":
            body["csrfToken"] = self._csrf_token_for(session_id, self._csrf_secret)
        return body

    def _valid_csrf_token(self, session_id: str, presented: str) -> bool:
        if not presented:
            return False
        for key in (self._csrf_secret, self._csrf_previous):
            expected = self._csrf_token_for(session_id, key)
            if expected and safe_equal(expected, presented):
                return True
        return False

    # ── hooks ──

    def _cors_preflight(self) -> Response | None:
        if request.method == "OPTIONS" and request.headers.get("Access-Control-Request-Method") is not None:
            return Response(status=204)
        return None

    def _cors_headers(self, response: Response) -> Response:
        origin = request.headers.get("Origin")
        trusted = origin is not None and origin in self._trusted
        if trusted:
            # An explicit allow-list only, never reflection (SEC-CORS-001).
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers.add("Vary", "Origin")
        if trusted and request.method == "OPTIONS" and request.headers.get("Access-Control-Request-Method") is not None:
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, " + self.config.http.csrf.header_name
            response.headers["Access-Control-Max-Age"] = "600"
        return response

    def _auth_headers(self, response: Response) -> Response:
        base = self.config.http.base_path.rstrip("/")
        if request.path == base or request.path.startswith(base + "/"):
            response.headers["Cache-Control"] = "no-store"  # AUTHN-ME-003, SEC-HTTP-001
            response.headers["Referrer-Policy"] = "no-referrer"
        return response

    def _session(self) -> None:
        name = self.config.authentication.sessions.cookie.name
        token = unquote(request.cookies.get(name, ""))
        setattr(g, _PRESENTED, token)
        context = self.service.authenticate(token)
        if context is not None:
            setattr(g, _CONTEXT, context)

    def _csrf(self) -> None:
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return  # SEC-CSRF-002: safe methods never change state
        csrf = self.config.http.csrf
        fetch_site = request.headers.get("Sec-Fetch-Site", "")
        origin = request.headers.get("Origin")
        presented = request.headers.get(csrf.header_name, "")
        session = self.context()
        origin_trusted = origin is not None and origin in self._trusted

        ok = fetch_site != "cross-site" and (origin is None or origin_trusted)
        if ok and csrf.mode == "header":
            ok = presented != ""
        elif ok and session is not None:
            ok = self._valid_csrf_token(session.session.id, presented)
        elif ok:
            # Token mode without a session (login, registration): require browser origin proof.
            ok = origin_trusted or fetch_site == "same-origin"
        if ok:
            return
        self.service.csrf_rejected(self._request_context())
        raise AuthError(errors.CSRF_FAILED, "Request origin could not be verified.")

    # ── guards ──

    def require_auth(self, view: Callable[..., Any]) -> Callable[..., Any]:
        """Allows any signed-in user."""

        @functools.wraps(view)
        def guarded(*args: Any, **kwargs: Any) -> Any:
            if self.context() is None:
                raise fail(errors.UNAUTHENTICATED)
            return view(*args, **kwargs)

        return guarded

    def _assert_known(self, permission: str) -> None:
        if permission not in self._known:
            raise ValueError(f"unknown permission {permission!r} (AUTHZ-PERM-004)")

    def require_permission(self, permission: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Allows subjects that hold `permission`. Raises at definition time for an undefined
        permission (AUTHZ-PERM-004)."""
        self._assert_known(permission)

        def decorate(view: Callable[..., Any]) -> Callable[..., Any]:
            @functools.wraps(view)
            def guarded(*args: Any, **kwargs: Any) -> Any:
                session = self.context()
                if session is None:
                    raise fail(errors.UNAUTHENTICATED)
                if not session.has(permission):
                    raise fail(errors.FORBIDDEN)
                setattr(g, _AUTHORIZED, True)
                return view(*args, **kwargs)

            return guarded

        return decorate

    def authorize_resource(
        self,
        permission: str,
        resource_type: str | Callable[[dict[str, Any]], str],
        resource_id: str | Callable[[dict[str, Any]], str] = "id",
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Decides on a resource loaded from storage by its registered policy. `resource_id` is
        the name of the URL parameter that holds the id (default "id"), or a function that reads
        it from the route's arguments; `resource_type` is a fixed name or such a function too."""
        self._assert_known(permission)

        def decorate(view: Callable[..., Any]) -> Callable[..., Any]:
            @functools.wraps(view)
            def guarded(*args: Any, **kwargs: Any) -> Any:
                session = self.context()
                if session is None:
                    raise fail(errors.UNAUTHENTICATED)
                rid = resource_id(kwargs) if callable(resource_id) else str(kwargs.get(resource_id, ""))
                rtype = resource_type(kwargs) if callable(resource_type) else resource_type
                decision = self.policies.decide(session.subject, permission, rtype, rid)
                if decision == ALLOW:
                    setattr(g, _AUTHORIZED, True)
                    return view(*args, **kwargs)
                raise fail(errors.NOT_FOUND if decision == NOT_FOUND else errors.FORBIDDEN)

            return guarded

        return decorate

    def protected(self, target: Flask | Blueprint, prefix: str = "") -> "ProtectedRoutes":
        """Routes that are denied unless a guard explicitly allows them (AUTHZ-CORE-001)."""
        return ProtectedRoutes(self, target, prefix)

    def _deny_unless_authorized(self, view: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(view)
        def checked(*args: Any, **kwargs: Any) -> Any:
            if getattr(g, _AUTHORIZED, False) is not True:
                raise fail(errors.FORBIDDEN)
            return view(*args, **kwargs)

        return checked

    # ── the /auth routes ──

    def _blueprint(self) -> Blueprint:
        bp = Blueprint("selfauth", __name__, url_prefix=self.config.http.base_path.rstrip("/") or None)
        svc = self.service

        def session() -> Context:
            context = self.context()
            if context is None:
                raise fail(errors.UNAUTHENTICATED)
            return context

        def no_content() -> Response:
            return Response(status=204)

        @bp.post("/register")
        def register() -> Response:
            result = svc.register(httpx.body(), self._request_context())
            if result.signed_in and result.issued is not None:
                response = jsonify(self._with_csrf({"user": result.user}, result.issued.session.id))
                response.status_code = 201
                self._set_session_cookie(response, result.issued)
                return response
            response = jsonify({"status": "accepted"})
            response.status_code = 202
            return response

        @bp.post("/login")
        def login() -> Response:
            user, issued = svc.login(httpx.body(), getattr(g, _PRESENTED, ""), self._request_context())
            response = jsonify(self._with_csrf({"user": user}, issued.session.id))
            self._set_session_cookie(response, issued)
            return response

        @bp.post("/logout")
        def logout() -> Response:
            svc.logout(getattr(g, _PRESENTED, ""), self._request_context())
            response = no_content()
            self._clear_session_cookie(response)
            return response

        @bp.post("/logout-all")
        def logout_all() -> Response:
            svc.logout_all(session(), self._request_context())
            response = no_content()
            self._clear_session_cookie(response)
            return response

        @bp.get("/me")
        def me() -> Response:
            context = session()
            return jsonify(self._with_csrf(svc.current_user(context), context.session.id))

        @bp.get("/sessions")
        def sessions() -> Response:
            return jsonify({"sessions": svc.list_sessions(session())})

        @bp.delete("/sessions/<session_id>")
        def revoke_session(session_id: str) -> Response:
            svc.revoke_session(session(), session_id, self._request_context())
            return no_content()

        @bp.post("/email/verification")
        def email_verification() -> Response:
            svc.request_email_verification(httpx.body(), self._request_context())
            response = jsonify({"status": "accepted"})
            response.status_code = 202
            return response

        @bp.post("/email/verify")
        def email_verify() -> Response:
            svc.verify_email(httpx.body(), self._request_context())
            return jsonify({"status": "verified"})

        @bp.post("/password/change")
        def password_change() -> Response:
            issued = svc.change_password(session(), httpx.body(), self._request_context())
            response = jsonify(self._with_csrf({"status": "changed"}, issued.session.id))
            self._set_session_cookie(response, issued)
            return response

        @bp.post("/password/reset-request")
        def password_reset_request() -> Response:
            svc.request_password_reset(httpx.body(), self._request_context())
            response = jsonify({"status": "accepted"})
            response.status_code = 202
            return response

        @bp.post("/password/reset")
        def password_reset() -> Response:
            svc.reset_password(httpx.body(), self._request_context())
            return no_content()

        @bp.post("/account/delete")
        def account_delete() -> Response:
            svc.delete_account(session(), httpx.body(), self._request_context())
            response = no_content()
            self._clear_session_cookie(response)
            return response

        @bp.post("/admin/users/<user_id>/state")
        def admin_state(user_id: str) -> Response:
            svc.set_account_state(session(), user_id, httpx.body(), self._request_context())
            return no_content()

        @bp.post("/admin/users/<user_id>/roles")
        def admin_assign_role(user_id: str) -> Response:
            svc.assign_role(session(), user_id, httpx.body(), self._request_context())
            return no_content()

        @bp.delete("/admin/users/<user_id>/roles/<role>")
        def admin_remove_role(user_id: str, role: str) -> Response:
            svc.remove_role(session(), user_id, role, self._request_context())
            return no_content()

        return bp


class ProtectedRoutes:
    """Registers routes that are denied unless a guard explicitly allows them (AUTHZ-CORE-001):
    authentication first, then your guards, then the deny-unless-authorized check, then the view."""

    def __init__(self, auth: Auth, target: Flask | Blueprint, prefix: str = "") -> None:
        self._auth = auth
        self._target = target
        self._prefix = prefix.rstrip("/")

    def route(
        self, rule: str, *guards: Callable[[Callable[..., Any]], Callable[..., Any]], methods: tuple[str, ...] = ("GET",),
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def decorate(view: Callable[..., Any]) -> Callable[..., Any]:
            wrapped = self._auth._deny_unless_authorized(view)
            for guard in reversed(guards):
                wrapped = guard(wrapped)
            wrapped = self._auth.require_auth(wrapped)
            endpoint = f"{self._prefix}{rule}:{','.join(methods)}:{view.__name__}"
            self._target.add_url_rule(self._prefix + rule, endpoint=endpoint, view_func=wrapped, methods=list(methods))
            return view

        return decorate

    def get(self, rule: str, *guards: Callable[[Callable[..., Any]], Callable[..., Any]]) -> Callable[..., Any]:
        return self.route(rule, *guards, methods=("GET",))

    def post(self, rule: str, *guards: Callable[[Callable[..., Any]], Callable[..., Any]]) -> Callable[..., Any]:
        return self.route(rule, *guards, methods=("POST",))

    def put(self, rule: str, *guards: Callable[[Callable[..., Any]], Callable[..., Any]]) -> Callable[..., Any]:
        return self.route(rule, *guards, methods=("PUT",))

    def patch(self, rule: str, *guards: Callable[[Callable[..., Any]], Callable[..., Any]]) -> Callable[..., Any]:
        return self.route(rule, *guards, methods=("PATCH",))

    def delete(self, rule: str, *guards: Callable[[Callable[..., Any]], Callable[..., Any]]) -> Callable[..., Any]:
        return self.route(rule, *guards, methods=("DELETE",))


class _TrustedProxies:
    """Works out the client address from X-Forwarded-For (SEC-RATE-005). With `false` (the default)
    no forwarding header is trusted; a hop count trusts that many proxies in front of the app; a
    list of addresses or CIDRs trusts exactly those proxies."""

    def __init__(self, setting: Any) -> None:
        self._hops = 0
        self._networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
        if isinstance(setting, int) and not isinstance(setting, bool):
            self._hops = setting
        elif isinstance(setting, list):
            self._networks = [ipaddress.ip_network(entry, strict=False) for entry in setting]

    def client_ip(self) -> str:
        remote = request.remote_addr or ""
        if not self._hops and not self._networks:
            return remote
        forwarded = [part.strip() for part in request.headers.get("X-Forwarded-For", "").split(",") if part.strip()]
        addresses = [remote, *reversed(forwarded)]  # nearest to the app first
        if self._hops:
            return addresses[self._hops] if self._hops < len(addresses) else addresses[-1]
        for candidate in addresses:
            try:
                ip = ipaddress.ip_address(candidate)
            except ValueError:
                return candidate
            if not any(ip in network for network in self._networks):
                return candidate
        return addresses[-1]
