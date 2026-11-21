"""The authentication and authorization rules, with no HTTP in them (AUTHENTICATION_SPEC)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

from ..config import Config
from . import errors, mailer as mail, store as st
from .authz import ADMIN_ROLE, Subject
from .clock import Clock, iso, millis
from .crypto import new_id, random_token, sha256_hex
from .email import normalize_email, validate_email
from .errors import AuthError, fail, validation
from .mailer import EmailMessage, Mailer
from .password import PasswordHasher, check_password_policy
from .ratelimit import LimitRule, RateLimiter
from .store import EmailTaken, EventRecord, SessionRecord, Store, TokenRecord, UserPatch, UserRecord

MINUTE_MS = 60 * 1000


@dataclass
class RequestContext:
    """Per-request facts the service needs, supplied by the transport adapter."""

    ip_address: str = ""
    user_agent: str = ""
    request_id: str = ""

    def addr(self) -> str:
        return self.ip_address or "null"


@dataclass
class Context:
    """A validated session plus the subject derived from server-side state."""

    subject: Subject
    session: SessionRecord
    user: UserRecord

    @property
    def user_id(self) -> str:
        return self.subject.user_id

    @property
    def roles(self) -> tuple[str, ...]:
        return self.subject.roles

    @property
    def permissions(self) -> frozenset[str]:
        return self.subject.permissions

    def has(self, permission: str) -> bool:
        return self.subject.has(permission)


@dataclass
class IssuedSession:
    """A newly created session. The token goes only into the cookie (AUTHN-SESS-001)."""

    token: str
    session: SessionRecord


@dataclass
class RegisterResult:
    """Either "accepted" (no session) or "signed in"."""

    signed_in: bool = False
    user: dict[str, Any] = field(default_factory=dict)
    issued: IssuedSession | None = None


@dataclass
class Deps:
    config: Config
    store: Store
    mailer: Mailer
    clock: Clock
    hasher: PasswordHasher
    limiter: RateLimiter
    # Builds email links; never derived from request headers (AUTHN-VERIFY-009).
    app_base_url: str


_ADMIN_TRANSITIONS: dict[str, tuple[str, ...]] = {
    st.PENDING: (st.DISABLED, st.DELETED),
    st.ACTIVE: (st.SUSPENDED, st.DISABLED, st.DELETED),
    st.SUSPENDED: (st.ACTIVE, st.DISABLED, st.DELETED),
    st.DISABLED: (st.ACTIVE, st.DELETED),
    st.DELETED: (),
}
_ACCOUNT_STATES = (st.PENDING, st.ACTIVE, st.SUSPENDED, st.DISABLED, st.DELETED)


def _or_none(value: str) -> str | None:
    return value or None


def _require_email(value: object) -> tuple[str, str]:
    email = validate_email(value)
    if email is None:
        raise validation("Enter a valid email address.", "email", "invalid_format")
    return email, normalize_email(email)


def _require_string(value: object, field_name: str) -> str:
    if not isinstance(value, str) or value == "":
        raise validation(f"{field_name} is required.", field_name, "required")
    return value


def _require_permission(a: Context, permission: str) -> None:
    if not a.has(permission):
        raise fail(errors.FORBIDDEN)


class Service:
    def __init__(self, deps: Deps) -> None:
        self.d = deps
        self.cfg = deps.config.authentication

    # ───────────────────────────── helpers ─────────────────────────────

    def now(self) -> datetime:
        return self.d.clock.now()

    def _event(
        self, kind: str, outcome: str, rc: RequestContext, user_id: str = "", actor_id: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        self.d.store.record_event(
            EventRecord(
                id=new_id(), type=kind, outcome=outcome, occurred_at=self.now(),
                user_id=_or_none(user_id), actor_id=_or_none(actor_id),
                ip_address=_or_none(rc.ip_address), user_agent=_or_none(rc.user_agent),
                request_id=_or_none(rc.request_id), metadata=metadata or {},
            )
        )

    def _limit(self, key: str, rule: Any, rc: RequestContext) -> None:
        """Counts a hit and raises RATE_LIMITED when blocked."""
        result = self.d.limiter.hit(key, LimitRule(rule.limit, rule.window_seconds))
        if result.just_blocked:
            # The key's scope (for example "login:acct") is logged; the identifier itself is not.
            scope = ":".join(key.split(":", 2)[:2])
            self._event("rate_limit.triggered", "failure", rc, metadata={"scope": scope})
        if not result.allowed:
            raise AuthError(errors.RATE_LIMITED, errors.MESSAGES[errors.RATE_LIMITED], retry_after_seconds=result.retry_after_seconds)

    def _link(self, path: str, token: str) -> str:
        parts = urlsplit(self.d.app_base_url)
        base_path = parts.path if parts.path.endswith("/") else parts.path + "/"
        base = urlunsplit((parts.scheme, parts.netloc, base_path, "", ""))
        # The fragment keeps the token out of server logs and Referer headers (SEC-TOKEN-005).
        return urljoin(base, path) + "#token=" + token

    def _send_mail(self, kind: str, to: str, subject: str, text: str, link: str = "", token: str = "") -> None:
        self.d.mailer.send(EmailMessage(kind=kind, to=to, subject=subject, text=text, link=link, token=token))

    def _issue_token(self, kind: str, user: UserRecord, ttl_minutes: int) -> str:
        now = self.now()
        # A new token supersedes earlier unused ones (AUTHN-RESET-004, AUTHN-VERIFY-003).
        self.d.store.invalidate_user_tokens(user.id, kind, now)
        token = random_token()
        self.d.store.create_token(
            TokenRecord(
                id=new_id(), kind=kind, user_id=user.id, token_hash=sha256_hex(token),
                email=user.email_normalized if kind == st.TOKEN_EMAIL_VERIFICATION else None,
                expires_at=now + timedelta(minutes=ttl_minutes), created_at=now,
            )
        )
        return token

    def _send_verification(self, user: UserRecord) -> None:
        if user.email is None:
            return
        token = self._issue_token(st.TOKEN_EMAIL_VERIFICATION, user, self.cfg.email_verification.token_ttl_minutes)
        link = self._link("verify-email", token)
        self._send_mail(
            mail.VERIFICATION, user.email, "Verify your email address",
            "Open this link to verify your email address: " + link, link, token,
        )

    def _create_session(self, user: UserRecord, rc: RequestContext) -> IssuedSession:
        now = self.now()
        absolute = now + timedelta(minutes=self.cfg.sessions.absolute_timeout_minutes)
        idle = min(now + timedelta(minutes=self.cfg.sessions.idle_timeout_minutes), absolute)
        token = random_token()
        session = SessionRecord(
            id=new_id(), token_hash=sha256_hex(token), user_id=user.id, created_at=now, last_seen_at=now,
            idle_expires_at=idle, absolute_expires_at=absolute, ip_address=_or_none(rc.ip_address),
            user_agent=_or_none(rc.user_agent), reauthenticated_at=now,
        )
        self.d.store.create_session(session)
        return IssuedSession(token, session)

    def public_user(self, user: UserRecord) -> dict[str, Any]:
        """The user as exposed over HTTP."""
        roles = self.d.store.get_user_roles(user.id)
        perms = self.d.store.get_role_permissions(roles)
        return {
            "id": user.id, "email": user.email, "emailVerified": user.email_verified_at is not None,
            "state": user.state, "roles": sorted(roles), "permissions": sorted(perms),
        }

    def _verify_current_password(self, a: Context, password: object, rc: RequestContext) -> None:
        rules = self.cfg.rate_limit.password_change
        self._limit("pwchg:addr:" + rc.addr(), rules.per_address, rc)
        # Counted before the hash, atomically (see login): concurrent guesses cannot exceed the limit.
        account_key = "pwchg:acct:" + a.user_id
        self._limit(account_key, rules.per_account, rc)
        stored = self.d.store.get_password_hash(a.user_id)
        if not isinstance(password, str) or stored is None or not self.d.hasher.verify(stored, password):
            raise fail(errors.INVALID_CREDENTIALS)
        self.d.limiter.reset(account_key)

    def _require_recent_auth(self, a: Context) -> None:
        """Admin operations need a recent password entry (AUTHZ-ADMIN-004)."""
        at = millis(a.session.reauthenticated_at) if a.session.reauthenticated_at else 0
        window = self.d.config.authorization.reauthentication_window_minutes * MINUTE_MS
        if millis(self.now()) - at > window:
            raise fail(errors.REAUTHENTICATION_REQUIRED)

    def _is_last_active_admin(self, user: UserRecord) -> bool:
        if user.state != st.ACTIVE:
            return False
        if ADMIN_ROLE not in self.d.store.get_user_roles(user.id):
            return False
        return self.d.store.count_active_users_with_role(ADMIN_ROLE) <= 1

    def _delete_user(self, user: UserRecord, actor_id: str, rc: RequestContext) -> None:
        now = self.now()
        store = self.d.store
        # IDENT-DELETE-001/002: tombstone, release the email, drop credentials, revoke everything.
        store.update_user(user.id, UserPatch(state=st.DELETED, deleted_at=now, updated_at=now, clear_email=True))
        store.delete_credentials(user.id)
        store.revoke_user_sessions(user.id, st.REVOKED_STATE_CHANGED, now)
        store.invalidate_user_tokens(user.id, st.TOKENS_ALL, now)
        self._event("account.state_changed", "success", rc, user.id, actor_id, {"from": user.state, "to": "deleted"})

    def csrf_rejected(self, rc: RequestContext) -> None:
        """Records csrf.rejected, at most once per client address per minute (SEC-CSRF-005)."""
        result = self.d.limiter.hit("csrf:addr:" + rc.addr(), LimitRule(1, 60))
        if result.allowed:
            self._event("csrf.rejected", "failure", rc)

    # ─────────────────────────── registration ───────────────────────────

    def register(self, body: dict[str, Any], rc: RequestContext) -> RegisterResult:
        email, normalized = _require_email(body.get("email"))
        password = check_password_policy(body.get("password"), self.cfg.password, email)
        rules = self.cfg.rate_limit.register
        self._limit("register:addr:" + rc.addr(), rules.per_address, rc)
        self._limit("register:acct:" + normalized, rules.per_account, rc)

        # Hash on every path so timing does not reveal existing accounts (AUTHN-REG-010).
        password_hash = self.d.hasher.hash(password)
        reveal = self.cfg.registration.reveal_existing_email

        existing = self.d.store.find_user_by_email(normalized)
        if existing is not None:
            return self._register_existing(existing, reveal)

        mode = self.cfg.email_verification.mode
        now = self.now()
        state = st.PENDING if mode == "required" else st.ACTIVE
        try:
            # Only server-chosen values; client-supplied state, roles and id are ignored (AUTHN-REG-002).
            user = self.d.store.create_user(
                UserRecord(id=new_id(), email=email, email_normalized=normalized, state=state, created_at=now, updated_at=now),
                password_hash,
                list(self.d.config.authorization.default_roles),
            )
        except EmailTaken:
            # Lost a concurrent race for the same email (AUTHN-REG-007).
            winner = self.d.store.find_user_by_email(normalized)
            if winner is None:
                raise
            return self._register_existing(winner, reveal)

        self._event("user.registered", "success", rc, user.id)
        if mode != "off":
            self._send_verification(user)
        if self.cfg.registration.sign_in_after_registration:
            issued = self._create_session(user, rc)
            return RegisterResult(True, self.public_user(user), issued)
        return RegisterResult()

    def _register_existing(self, existing: UserRecord, reveal: bool) -> RegisterResult:
        if reveal:
            raise fail(errors.EMAIL_TAKEN)  # AUTHN-REG-011 (opt-in)
        # AUTHN-REG-005: the same outcome as a new registration; the owner is told instead.
        if existing.email is not None:
            self._send_mail(
                mail.ACCOUNT_EXISTS, existing.email, "Someone tried to create an account with your email",
                "An account already exists for this address. If this was you, sign in or reset your password. "
                "Otherwise you can ignore this message.",
            )
        return RegisterResult()

    # ─────────────────────────────── login ───────────────────────────────

    def login(self, body: dict[str, Any], presented_token: str, rc: RequestContext) -> tuple[dict[str, Any], IssuedSession]:
        _, normalized = _require_email(body.get("email"))
        password = _require_string(body.get("password"), "password")
        rules = self.cfg.rate_limit.login
        self._limit("login:addr:" + rc.addr(), rules.per_address, rc)
        account_key = "login:acct:" + normalized
        # Applies whether or not the account exists (AUTHN-LOGIN-006, SEC-RATE-004). The attempt is
        # counted here, before the slow password hash, in one atomic step: concurrent requests then
        # cannot all pass a read-only check and evaluate more guesses than the limit allows
        # (SEC-RATE-001). A verified password clears the count below.
        self._limit(account_key, rules.per_account, rc)

        store, hasher = self.d.store, self.d.hasher
        user = store.find_user_by_email(normalized)
        stored_hash = store.get_password_hash(user.id) if user is not None else None
        verified = False
        if stored_hash is not None and len(password) <= self.cfg.password.max_length:
            verified = hasher.verify(stored_hash, password)
        else:
            hasher.verify_dummy(password)  # AUTHN-LOGIN-003

        if user is None or not verified:
            self._event("auth.login.failed", "failure", rc, user.id if user else "")
            raise fail(errors.INVALID_CREDENTIALS)  # AUTHN-LOGIN-002

        # The right password ends the guessing, whatever the account's state.
        self.d.limiter.reset(account_key)
        # State is revealed only after the password is verified (AUTHN-LOGIN-004).
        if user.state != st.ACTIVE:
            self._event("auth.login.failed", "failure", rc, user.id, metadata={"reason": user.state})
            raise fail(errors.EMAIL_NOT_VERIFIED if user.state == st.PENDING else errors.ACCOUNT_UNAVAILABLE)

        if stored_hash is not None and hasher.needs_rehash(stored_hash):
            store.set_password_hash(user.id, hasher.hash(password), self.now())  # SEC-HASH-004

        # Never adopt a client-supplied session; revoke whatever was presented (AUTHN-LOGIN-005).
        if presented_token:
            previous = store.find_session_by_token_hash(sha256_hex(presented_token))
            if previous is not None and previous.revoked_at is None:
                store.revoke_session(previous.id, st.REVOKED_ROTATED, self.now())
        issued = self._create_session(user, rc)
        self._event("auth.login.succeeded", "success", rc, user.id)
        return self.public_user(user), issued

    # ───────────────────────────── sessions ─────────────────────────────

    def authenticate(self, token: str) -> Context | None:
        """Validates a session token (AUTHN-SESS-003..006). None when unauthenticated."""
        if not token:
            return None
        store = self.d.store
        session = store.find_session_by_token_hash(sha256_hex(token))
        if session is None:
            return None
        now = self.now()
        if session.revoked_at is not None or now >= session.idle_expires_at or now >= session.absolute_expires_at:
            return None
        user = store.find_user_by_id(session.user_id)
        if user is None or user.state != st.ACTIVE:  # IDENT-STATE-004
            return None

        if now - session.last_seen_at >= timedelta(seconds=self.cfg.sessions.touch_interval_seconds):
            # Sliding idle expiry, never beyond the absolute expiry (AUTHN-SESS-004).
            idle = min(now + timedelta(minutes=self.cfg.sessions.idle_timeout_minutes), session.absolute_expires_at)
            store.touch_session(session.id, now, idle)
            session.last_seen_at, session.idle_expires_at = now, idle

        # Roles and permissions are read on every request (AUTHZ-CORE-006).
        roles = store.get_user_roles(user.id)
        perms = store.get_role_permissions(roles)
        return Context(Subject(user.id, tuple(roles), frozenset(perms)), session, user)

    def logout(self, token: str, rc: RequestContext) -> None:
        if not token:
            return  # AUTHN-LOGOUT-003
        session = self.d.store.find_session_by_token_hash(sha256_hex(token))
        if session is None or session.revoked_at is not None:
            return
        self.d.store.revoke_session(session.id, st.REVOKED_LOGOUT, self.now())
        self._event("auth.logout", "success", rc, session.user_id)

    def logout_all(self, a: Context, rc: RequestContext) -> None:
        self.d.store.revoke_user_sessions(a.user_id, st.REVOKED_LOGOUT_ALL, self.now())
        self._event("auth.sessions.revoked_all", "success", rc, a.user_id)

    def current_user(self, a: Context) -> dict[str, Any]:
        """The body of GET /me (without the CSRF token)."""
        return {
            "user": self.public_user(a.user),
            "session": {
                "id": a.session.id, "createdAt": iso(a.session.created_at),
                "idleExpiresAt": iso(a.session.idle_expires_at), "absoluteExpiresAt": iso(a.session.absolute_expires_at),
            },
        }

    def list_sessions(self, a: Context) -> list[dict[str, Any]]:
        sessions = self.d.store.list_active_sessions(a.user_id, self.now())
        return [
            {
                "id": s.id, "current": s.id == a.session.id, "createdAt": iso(s.created_at),
                "lastSeenAt": iso(s.last_seen_at), "userAgent": s.user_agent,
            }
            for s in sessions
        ]

    def revoke_session(self, a: Context, session_id: str, rc: RequestContext) -> None:
        session = self.d.store.find_session_by_id(session_id)
        if session is None or session.user_id != a.user_id or session.revoked_at is not None:
            raise fail(errors.NOT_FOUND)
        self.d.store.revoke_session(session.id, st.REVOKED_LOGOUT, self.now())
        self._event("auth.logout", "success", rc, a.user_id, metadata={"sessionId": session.id})

    # ─────────────────────────── email verification ───────────────────────────

    def request_email_verification(self, body: dict[str, Any], rc: RequestContext) -> None:
        _, normalized = _require_email(body.get("email"))
        rules = self.cfg.rate_limit.verification_resend
        self._limit("verify:addr:" + rc.addr(), rules.per_address, rc)
        self._limit("verify:acct:" + normalized, rules.per_account, rc)
        if self.cfg.email_verification.mode == "off":
            return
        user = self.d.store.find_user_by_email(normalized)
        # The same outcome whatever the account's status (AUTHN-VERIFY-001).
        if user is not None and user.email_verified_at is None and user.state in (st.PENDING, st.ACTIVE):
            self._send_verification(user)

    def verify_email(self, body: dict[str, Any], rc: RequestContext) -> None:
        raw = body.get("token")
        raw = raw if isinstance(raw, str) else ""
        store = self.d.store
        now = self.now()
        token = store.find_token(st.TOKEN_EMAIL_VERIFICATION, sha256_hex(raw)) if raw else None
        user = store.find_user_by_id(token.user_id) if token is not None else None
        valid = (
            token is not None and user is not None and token.used_at is None and token.invalidated_at is None
            and now < token.expires_at and user.state in (st.PENDING, st.ACTIVE)
            and token.email is not None and user.email_normalized is not None
            and token.email == user.email_normalized  # AUTHN-VERIFY-005
        )
        if not valid:
            raise fail(errors.TOKEN_INVALID)
        assert token is not None and user is not None
        if not store.consume_token(token.id, now):
            raise fail(errors.TOKEN_INVALID)

        patch = UserPatch(email_verified_at=now, updated_at=now)
        if user.state == st.PENDING:
            patch.state = st.ACTIVE
        store.update_user(user.id, patch)
        self._event("email.verified", "success", rc, user.id)
        if user.state == st.PENDING:
            self._event("account.state_changed", "success", rc, user.id, user.id, {"from": "pending", "to": "active"})

    # ─────────────────────────── password change ───────────────────────────

    def change_password(self, a: Context, body: dict[str, Any], rc: RequestContext) -> IssuedSession:
        self._verify_current_password(a, body.get("currentPassword"), rc)
        new_password = check_password_policy(body.get("newPassword"), self.cfg.password, a.user.email or "")
        store = self.d.store
        now = self.now()
        store.set_password_hash(a.user_id, self.d.hasher.hash(new_password), now)
        # AUTHN-PWCHG-003: other sessions are revoked; the current one is replaced.
        store.revoke_user_sessions(a.user_id, st.REVOKED_PASSWORD_CHANGED, now, a.session.id)
        store.revoke_session(a.session.id, st.REVOKED_ROTATED, now)
        issued = self._create_session(a.user, rc)
        store.invalidate_user_tokens(a.user_id, st.TOKEN_PASSWORD_RESET, now)  # AUTHN-PWCHG-004
        self.d.limiter.reset("pwchg:acct:" + a.user_id)
        self._event("password.changed", "success", rc, a.user_id)
        if a.user.email is not None:
            self._send_mail(
                mail.PASSWORD_CHANGED, a.user.email, "Your password was changed",
                "Your password was just changed. If this was not you, reset your password immediately.",
            )
        return issued

    # ─────────────────────────── password reset ───────────────────────────

    def request_password_reset(self, body: dict[str, Any], rc: RequestContext) -> None:
        _, normalized = _require_email(body.get("email"))
        rules = self.cfg.rate_limit.password_reset_request
        self._limit("reset:addr:" + rc.addr(), rules.per_address, rc)
        self._limit("reset:acct:" + normalized, rules.per_account, rc)
        user = self.d.store.find_user_by_email(normalized)
        # AUTHN-RESET-002: only active or pending accounts receive a token.
        if user is None or user.email is None or user.state not in (st.ACTIVE, st.PENDING):
            return
        token = self._issue_token(st.TOKEN_PASSWORD_RESET, user, self.cfg.password_reset.token_ttl_minutes)
        link = self._link("reset-password", token)
        self._send_mail(
            mail.PASSWORD_RESET, user.email, "Reset your password",
            "Open this link to choose a new password: " + link + "\nIf you did not ask for this, ignore this email.",
            link, token,
        )
        self._event("password.reset.requested", "success", rc, user.id)

    def reset_password(self, body: dict[str, Any], rc: RequestContext) -> None:
        raw = body.get("token")
        raw = raw if isinstance(raw, str) else ""
        store = self.d.store
        token = store.find_token(st.TOKEN_PASSWORD_RESET, sha256_hex(raw)) if raw else None
        user = store.find_user_by_id(token.user_id) if token is not None else None
        now = self.now()
        usable = (
            token is not None and user is not None and token.used_at is None and token.invalidated_at is None
            and now < token.expires_at and user.state in (st.ACTIVE, st.PENDING)  # AUTHN-RESET-007
        )
        if not usable:
            raise fail(errors.TOKEN_INVALID)
        assert token is not None and user is not None

        # The policy is checked before consuming, so a violation keeps the token usable (AUTHN-RESET-008).
        new_password = check_password_policy(body.get("newPassword"), self.cfg.password, user.email or "")
        password_hash = self.d.hasher.hash(new_password)
        if not store.consume_token(token.id, now):  # AUTHN-RESET-009
            raise fail(errors.TOKEN_INVALID)

        store.set_password_hash(user.id, password_hash, now)
        if user.state == st.PENDING:
            # AUTHN-RESET-011: the token proves control of the mailbox.
            store.update_user(user.id, UserPatch(state=st.ACTIVE, email_verified_at=now, updated_at=now))
        store.revoke_user_sessions(user.id, st.REVOKED_PASSWORD_RESET, now)  # AUTHN-RESET-010
        store.invalidate_user_tokens(user.id, st.TOKEN_PASSWORD_RESET, now)
        if user.email_normalized is not None:
            self.d.limiter.reset("login:acct:" + user.email_normalized)
        self._event("password.reset.completed", "success", rc, user.id)
        if user.email is not None:
            self._send_mail(
                mail.PASSWORD_RESET_COMPLETED, user.email, "Your password was reset",
                "Your password was just reset and all sessions were signed out. If this was not you, contact support.",
            )

    # ─────────────────────────── account deletion ───────────────────────────

    def delete_account(self, a: Context, body: dict[str, Any], rc: RequestContext) -> None:
        self._verify_current_password(a, body.get("currentPassword"), rc)  # IDENT-DELETE-003
        if self._is_last_active_admin(a.user):
            raise fail(errors.CONFLICT)  # AUTHZ-ADMIN-003
        self._delete_user(a.user, a.user_id, rc)

    # ─────────────────────────── administration ───────────────────────────

    def set_account_state(self, a: Context, target_id: str, body: dict[str, Any], rc: RequestContext) -> None:
        _require_permission(a, "auth.users.manage")
        self._require_recent_auth(a)
        raw = body.get("state")
        if not isinstance(raw, str) or raw not in _ACCOUNT_STATES:
            raise validation("Unknown account state.", "state", "invalid_value")
        nxt = raw
        store = self.d.store
        target = store.find_user_by_id(target_id)
        if target is None:
            raise fail(errors.NOT_FOUND)
        if nxt not in _ADMIN_TRANSITIONS[target.state]:
            raise fail(errors.CONFLICT)  # IDENT-STATE-002
        if nxt != st.ACTIVE and self._is_last_active_admin(target):
            raise fail(errors.CONFLICT)
        if nxt == st.DELETED:
            self._delete_user(target, a.user_id, rc)
            return
        now = self.now()
        store.update_user(target.id, UserPatch(state=nxt, updated_at=now))
        if nxt != st.ACTIVE:
            # IDENT-STATE-003, AUTHZ-ADMIN-006
            store.revoke_user_sessions(target.id, st.REVOKED_STATE_CHANGED, now)
            store.invalidate_user_tokens(target.id, st.TOKENS_ALL, now)
        self._event("account.state_changed", "success", rc, target.id, a.user_id, {"from": target.state, "to": nxt})

    def _require_delegable(self, a: Context, role: str) -> None:
        """Without auth.roles.manage, only roles within the actor's own permissions (AUTHZ-ADMIN-002)."""
        if a.has("auth.roles.manage"):
            return
        for permission in self.d.store.get_role_permissions([role]):
            if not a.has(permission):
                raise fail(errors.FORBIDDEN)

    def _role_target(self, a: Context, target_id: str, role: object) -> tuple[UserRecord, str]:
        _require_permission(a, "auth.roles.assign")
        self._require_recent_auth(a)
        if not isinstance(role, str) or not self.d.store.role_exists(role):
            raise fail(errors.NOT_FOUND)
        target = self.d.store.find_user_by_id(target_id)
        if target is None or target.state == st.DELETED:
            raise fail(errors.NOT_FOUND)
        self._require_delegable(a, role)
        return target, role

    def assign_role(self, a: Context, target_id: str, body: dict[str, Any], rc: RequestContext) -> None:
        target, role = self._role_target(a, target_id, body.get("role"))
        self.d.store.add_user_role(target.id, role, a.user_id, self.now())
        self._event("role.assigned", "success", rc, target.id, a.user_id, {"role": role})

    def remove_role(self, a: Context, target_id: str, role: str, rc: RequestContext) -> None:
        target, _ = self._role_target(a, target_id, role)
        if role == ADMIN_ROLE and self._is_last_active_admin(target):
            raise fail(errors.CONFLICT)
        self.d.store.remove_user_role(target.id, role)
        self._event("role.removed", "success", rc, target.id, a.user_id, {"role": role})
