"""The resolved SelfAuth configuration (CONFIGURATION_SPEC.md) and the process environment.

Configuration is behavior only, never secrets (CONF-FILE-002); secrets come from the environment.
"""

from __future__ import annotations

import base64
import dataclasses
import json
import os
import re
import typing
from dataclasses import dataclass, field
from urllib.parse import urlsplit

SPEC_MAJOR = "0"

# System permissions mirror the spec (AUTHORIZATION_SPEC §5); roles may reference them.
SYSTEM_PERMISSIONS = (
    "auth.users.read",
    "auth.users.manage",
    "auth.sessions.manage",
    "auth.roles.assign",
    "auth.roles.manage",
    "auth.audit.read",
)


@dataclass
class RateLimitRule:
    limit: int = 0
    window_seconds: int = 0


@dataclass
class RateLimitOperation:
    per_account: RateLimitRule = field(default_factory=RateLimitRule)
    per_address: RateLimitRule = field(default_factory=RateLimitRule)


@dataclass
class Adapter:
    backend: str = ""
    frontend: str = ""
    database: str = ""
    orm: str = ""


@dataclass
class Hashing:
    memory_kib: int = field(default=0, metadata={"json": "memoryKiB"})
    iterations: int = 0
    parallelism: int = 0


@dataclass
class Password:
    min_length: int = 0
    max_length: int = 0
    reject_common: bool = False
    hashing: Hashing = field(default_factory=Hashing)


@dataclass
class Cookie:
    name: str = ""
    same_site: str = ""
    secure: bool = False


@dataclass
class Sessions:
    strategy: str = ""
    idle_timeout_minutes: int = 0
    absolute_timeout_minutes: int = 0
    touch_interval_seconds: int = 0
    cookie: Cookie = field(default_factory=Cookie)


@dataclass
class RateLimits:
    login: RateLimitOperation = field(default_factory=RateLimitOperation)
    password_change: RateLimitOperation = field(default_factory=RateLimitOperation)
    register: RateLimitOperation = field(default_factory=RateLimitOperation)
    password_reset_request: RateLimitOperation = field(default_factory=RateLimitOperation)
    verification_resend: RateLimitOperation = field(default_factory=RateLimitOperation)


@dataclass
class EmailVerification:
    mode: str = ""
    token_ttl_minutes: int = 0


@dataclass
class Registration:
    reveal_existing_email: bool = False
    sign_in_after_registration: bool = False


@dataclass
class PasswordReset:
    token_ttl_minutes: int = 0


@dataclass
class Authentication:
    methods: list[str] = field(default_factory=list)
    email_verification: EmailVerification = field(default_factory=EmailVerification)
    registration: Registration = field(default_factory=Registration)
    password_reset: PasswordReset = field(default_factory=PasswordReset)
    password: Password = field(default_factory=Password)
    sessions: Sessions = field(default_factory=Sessions)
    rate_limit: RateLimits = field(default_factory=RateLimits)


@dataclass
class Authorization:
    strategy: str = ""
    permissions: list[str] = field(default_factory=list)
    roles: dict[str, list[str]] = field(default_factory=dict)
    default_roles: list[str] = field(default_factory=list)
    reauthentication_window_minutes: int = 0


@dataclass
class Csrf:
    mode: str = ""
    header_name: str = ""


@dataclass
class Http:
    body_limit_bytes: int = 0
    base_path: str = ""
    trusted_origins: list[str] = field(default_factory=list)
    trust_proxy: typing.Any = False
    csrf: Csrf = field(default_factory=Csrf)


@dataclass
class Config:
    spec_version: str = ""
    adapter: Adapter = field(default_factory=Adapter)
    authentication: Authentication = field(default_factory=Authentication)
    authorization: Authorization = field(default_factory=Authorization)
    http: Http = field(default_factory=Http)

    # ── loading ──

    @classmethod
    def parse(cls, text: str | bytes) -> "Config":
        """Decodes a resolved configuration. Unknown fields are rejected so a typo cannot silently
        weaken a setting, and out-of-range values are errors."""
        try:
            data = json.loads(text)
        except ValueError as exc:
            raise ConfigError([f"invalid selfauth configuration: {exc}"]) from exc
        problems: list[str] = []
        config = _build(cls, data, "", problems)
        if problems:
            raise ConfigError(problems)
        config.validate()
        return config

    @classmethod
    def load(cls, path: str) -> "Config":
        try:
            with open(path, "rb") as handle:
                data = handle.read()
        except OSError as exc:
            raise ConfigError([f"read {path}: {exc.strerror or exc}"]) from exc
        return cls.parse(data)

    def local_development(self) -> None:
        """Overrides only the cookie settings: plain-http local development cannot use Secure or
        __Host- cookies (SEC-COOKIE-003 forbids this in production)."""
        self.authentication.sessions.cookie.name = "dev_session"
        self.authentication.sessions.cookie.secure = False

    # ── validation ──

    def validate(self) -> None:
        """Enforces the same bounds as the specification's configuration schema: out-of-range
        values are rejected, never clamped (CONF-FILE-003)."""
        problems: list[str] = []

        def bad(message: str) -> None:
            problems.append(message)

        def between(name: str, value: int, low: int, high: int) -> None:
            if value < low or value > high:
                bad(f"{name} must be between {low} and {high} (got {value})")

        def one_of(name: str, value: str, *allowed: str) -> None:
            if value not in allowed:
                bad(f"{name} must be one of {', '.join(allowed)} (got {value!r})")

        if not _SPEC_VERSION.match(self.spec_version):
            bad("specVersion must look like 0.1")
        elif self.spec_version.split(".", 1)[0] != SPEC_MAJOR:
            bad(f"specVersion {self.spec_version} is not supported (this application implements {SPEC_MAJOR}.x)")

        a = self.adapter
        one_of("adapter.backend", a.backend, "express", "fastify", "gin", "flask")
        one_of("adapter.frontend", a.frontend, "vue", "react", "none")
        one_of("adapter.database", a.database, "postgresql", "mysql", "sqlite", "mongodb", "memory")
        orm = {"postgresql": "prisma", "mysql": "prisma", "sqlite": "prisma", "mongodb": "mongoose", "memory": "none"}.get(a.database, "")
        if a.backend in ("gin", "flask"):
            orm = "none"  # these backends use no ORM
        if a.orm != orm:
            bad(f"adapter.orm {a.orm!r} is not supported with database {a.database!r}")

        n = self.authentication
        if not n.methods:
            bad("authentication.methods needs at least one method")
        for method in n.methods:
            one_of("authentication.methods", method, "password")
        one_of("authentication.emailVerification.mode", n.email_verification.mode, "required", "optional", "off")
        between("authentication.emailVerification.tokenTtlMinutes", n.email_verification.token_ttl_minutes, 5, 10_080)
        between("authentication.passwordReset.tokenTtlMinutes", n.password_reset.token_ttl_minutes, 5, 60)

        pw = n.password
        between("authentication.password.minLength", pw.min_length, 8, 1024)  # SEC-PWPOLICY-001
        between("authentication.password.maxLength", pw.max_length, 64, 1024)
        if pw.min_length > pw.max_length:
            bad("authentication.password.minLength must not exceed maxLength")
        h = pw.hashing
        between("authentication.password.hashing.memoryKiB", h.memory_kib, 19_456, 4_194_304)
        between("authentication.password.hashing.iterations", h.iterations, 1, 10)
        between("authentication.password.hashing.parallelism", h.parallelism, 1, 16)
        # Minimum Argon2id profiles (SEC-HASH-002): 19 MiB with 2+ iterations, or 46 MiB with 1.
        if not (h.memory_kib >= 19_456 and h.iterations >= 2) and not (h.memory_kib >= 47_104 and h.iterations >= 1):
            bad(
                "authentication.password.hashing is below the minimum "
                "(19 MiB with 2+ iterations, or 46 MiB with 1 iteration; SEC-HASH-002)"
            )

        s = n.sessions
        one_of("authentication.sessions.strategy", s.strategy, "database")
        between("authentication.sessions.idleTimeoutMinutes", s.idle_timeout_minutes, 5, 525_600)
        between("authentication.sessions.absoluteTimeoutMinutes", s.absolute_timeout_minutes, 5, 525_600)
        if s.idle_timeout_minutes > s.absolute_timeout_minutes:
            bad("authentication.sessions.idleTimeoutMinutes must not exceed absoluteTimeoutMinutes")
        between("authentication.sessions.touchIntervalSeconds", s.touch_interval_seconds, 0, 3_600)
        if not _COOKIE_NAME.match(s.cookie.name):
            bad(f"authentication.sessions.cookie.name must match {_COOKIE_NAME.pattern}")
        one_of("authentication.sessions.cookie.sameSite", s.cookie.same_site, "lax", "strict", "none")
        if s.cookie.name.startswith("__Host-") and not s.cookie.secure:
            bad("__Host- cookies require secure: true; use another name for local http development")
        if s.cookie.same_site == "none" and not s.cookie.secure:
            bad("sameSite 'none' requires secure: true")
        if s.cookie.same_site == "none" and self.http.csrf.mode != "token":
            bad("sameSite 'none' requires http.csrf.mode 'token' (SEC-COOKIE-005, SEC-CSRF-004)")

        limits = n.rate_limit
        for name, op in (
            ("login", limits.login), ("passwordChange", limits.password_change), ("register", limits.register),
            ("passwordResetRequest", limits.password_reset_request), ("verificationResend", limits.verification_resend),
        ):
            for scope, rule in (("perAccount", op.per_account), ("perAddress", op.per_address)):
                between(f"authentication.rateLimit.{name}.{scope}.limit", rule.limit, 1, 1_000_000)
                between(f"authentication.rateLimit.{name}.{scope}.windowSeconds", rule.window_seconds, 1, 86_400)

        reg = n.registration
        if reg.sign_in_after_registration:
            if not reg.reveal_existing_email:
                bad(
                    "signInAfterRegistration requires revealExistingEmail: true, because an immediate "
                    "session reveals whether the email was new (AUTHN-REG-012)"
                )
            if n.email_verification.mode == "required":
                bad("signInAfterRegistration is not possible with emailVerification.mode 'required' (users are pending until verified)")

        z = self.authorization
        one_of("authorization.strategy", z.strategy, "rbac")
        defined: set[str] = set()
        for p in z.permissions:
            if not _PERMISSION.match(p):
                bad(f"permission {p!r} is not in the form resource.action (lowercase)")
            elif p.startswith("auth."):
                bad(f"permission {p!r}: the 'auth.' prefix is reserved for system permissions")
            elif p in defined:
                bad(f"duplicate permission {p!r}")
            defined.add(p)
        for role, perms in z.roles.items():
            if not _ROLE.match(role):
                bad(f"role name {role!r} must match {_ROLE.pattern}")
            for p in perms:
                if p not in defined and p not in SYSTEM_PERMISSIONS:
                    bad(f"role {role!r} references undefined permission {p!r}")
        if not z.default_roles:
            bad("authorization.defaultRoles needs at least one role")
        for r in z.default_roles:
            if r == "admin":
                bad("'admin' must not be a default role (AUTHZ-ADMIN-005)")
            elif r not in z.roles:
                bad(f"default role {r!r} is not defined in roles")
        between("authorization.reauthenticationWindowMinutes", z.reauthentication_window_minutes, 1, 1_440)

        http = self.http
        between("http.bodyLimitBytes", http.body_limit_bytes, 1_024, 1_048_576)
        if not _BASE_PATH.match(http.base_path):
            bad(f"http.basePath must match {_BASE_PATH.pattern}")
        for o in http.trusted_origins:
            try:
                parts = urlsplit(o)
                valid = parts.scheme in ("https", "http") and bool(parts.netloc) and origin_of(o) == o
            except ValueError:
                valid = False
            if not valid:
                bad(f"http.trustedOrigins: {o!r} must be an origin such as https://app.example.com (no path or trailing slash)")
        problem = self._trust_proxy_problem()
        if problem:
            bad(problem)
        one_of("http.csrf.mode", http.csrf.mode, "header", "token")
        if not _HEADER.match(http.csrf.header_name):
            bad(f"http.csrf.headerName must match {_HEADER.pattern}")

        if problems:
            raise ConfigError(problems)

    def _trust_proxy_problem(self) -> str | None:
        """The schema's shape: false, a hop count 1..32 or a non-empty list."""
        value = self.http.trust_proxy
        if value is None or value is False:
            return None
        if isinstance(value, int) and not isinstance(value, bool):
            return None if 1 <= value <= 32 else "http.trustProxy as a hop count must be between 1 and 32"
        if isinstance(value, list) and value and all(isinstance(e, str) for e in value):
            if any(e == "" for e in value):
                return "http.trustProxy entries must not be empty"
            return None
        return "http.trustProxy must be false, a hop count or a non-empty list of addresses"


class ConfigError(Exception):
    """The configuration, or the environment, is not valid. Every problem is listed."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("\n".join(problems))
        self.problems = problems


_SPEC_VERSION = re.compile(r"^\d+\.\d+$")
_PERMISSION = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")
_ROLE = re.compile(r"^[a-z][a-z0-9_-]*$")
_COOKIE_NAME = re.compile(r"^[A-Za-z0-9_-]+$")
_BASE_PATH = re.compile(r"^/[A-Za-z0-9/_-]*$")
_HEADER = re.compile(r"^[A-Za-z0-9-]+$")


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.capitalize() for part in rest)


def _build(cls: type, data: typing.Any, path: str, problems: list[str]) -> typing.Any:
    """Builds a dataclass from decoded JSON, listing unknown and mistyped fields."""
    if not isinstance(data, dict):
        problems.append(f"{path or 'configuration'} must be an object")
        return cls()
    hints = typing.get_type_hints(cls)
    known = {f.metadata.get("json", _camel(f.name)): f for f in dataclasses.fields(cls)}
    for key in data:
        if key not in known:
            problems.append(f"unknown field {(path + '.' if path else '') + key}")
    values: dict[str, typing.Any] = {}
    for json_name, f in known.items():
        where = f"{path}.{json_name}" if path else json_name
        if json_name not in data:
            problems.append(f"{where} is required")
            continue
        values[f.name] = _coerce(hints[f.name], data[json_name], where, problems)
    return cls(**values)


def _coerce(expected: typing.Any, value: typing.Any, where: str, problems: list[str]) -> typing.Any:
    if dataclasses.is_dataclass(expected):
        return _build(expected, value, where, problems)
    origin = typing.get_origin(expected)
    if origin is list:
        if not isinstance(value, list) or not all(isinstance(e, str) for e in value):
            problems.append(f"{where} must be a list of strings")
            return []
        return list(value)
    if origin is dict:
        ok = isinstance(value, dict) and all(isinstance(v, list) and all(isinstance(e, str) for e in v) for v in value.values())
        if not ok:
            problems.append(f"{where} must be an object of string lists")
            return {}
        return {k: list(v) for k, v in value.items()}
    if expected is typing.Any:
        return value
    if expected is bool:
        if not isinstance(value, bool):
            problems.append(f"{where} must be true or false")
            return False
        return value
    if expected is int:
        if isinstance(value, bool) or not isinstance(value, int):
            problems.append(f"{where} must be a whole number")
            return 0
        return value
    if expected is str:
        if not isinstance(value, str):
            problems.append(f"{where} must be text")
            return ""
        return value
    return value


def origin_of(url: str) -> str:
    """scheme://host[:port] with the default port removed, like URL#origin."""
    parts = urlsplit(url)
    host, port = parts.hostname or "", parts.port
    if (parts.scheme == "https" and port == 443) or (parts.scheme == "http" and port == 80):
        port = None
    if ":" in host:
        host = f"[{host}]"
    if port is not None:
        host = f"{host}:{port}"
    return f"{parts.scheme}://{host}"


# ───────────────────────────── environment ─────────────────────────────


@dataclass
class Env:
    """The startup configuration read from the environment. It fails fast: an invalid environment
    prevents the server from starting (SEC-SECRET-003)."""

    app_env: str = "development"  # development, test or production
    port: int = 3000
    app_base_url: str = ""
    csrf_secret: bytes | None = None
    csrf_secret_previous: bytes | None = None

    @property
    def production(self) -> bool:
        return self.app_env == "production"


def load_env(lookup: typing.Callable[[str], str | None] = os.environ.get) -> Env:
    """Reads the environment through `lookup` (os.environ.get for the real one)."""
    problems: list[str] = []

    def get(name: str, fallback: str) -> str:
        value = lookup(name)
        return value if value else fallback

    env = Env(app_env=get("APP_ENV", "development"))
    if env.app_env not in ("development", "test", "production"):
        problems.append(f"APP_ENV must be development, test or production (got {env.app_env!r})")

    try:
        env.port = int(get("PORT", "3000"))
        if not 1 <= env.port <= 65535:
            raise ValueError
    except ValueError:
        problems.append("PORT must be an integer between 1 and 65535")

    raw = get("SELFAUTH_APP_BASE_URL", "")
    if not raw:
        problems.append("SELFAUTH_APP_BASE_URL is required (used to build email links)")
    else:
        try:
            parts = urlsplit(raw)
            parts.port  # noqa: B018 - raises for an invalid port
            parsed = bool(parts.netloc)
        except ValueError:
            parsed = False
        if not parsed:
            problems.append("SELFAUTH_APP_BASE_URL is not a valid URL")
        elif parts.scheme not in ("https", "http"):
            problems.append("SELFAUTH_APP_BASE_URL must be an http(s) URL")
        elif any(ch in raw for ch in "\r\n\t ") or any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in raw):
            problems.append("SELFAUTH_APP_BASE_URL contains control characters")
        elif env.app_env == "production" and parts.scheme != "https":
            problems.append("SELFAUTH_APP_BASE_URL must use https in production (SEC-HTTP-002)")
        else:
            env.app_base_url = raw

    def secret(name: str) -> bytes | None:
        value = get(name, "")
        if not value:
            return None
        try:
            decoded = base64.urlsafe_b64decode(value.rstrip("=") + "=" * (-len(value.rstrip("=")) % 4))
        except ValueError:
            decoded = b""
        if len(decoded) < 32:
            problems.append(f"{name} must be at least 32 random bytes, base64url-encoded (SEC-SECRET-004)")
        return decoded

    env.csrf_secret = secret("SELFAUTH_CSRF_SECRET")
    env.csrf_secret_previous = secret("SELFAUTH_CSRF_SECRET_PREVIOUS")

    if problems:
        raise ConfigError(["invalid environment:", *[f"  - {p}" for p in problems]])
    return env
