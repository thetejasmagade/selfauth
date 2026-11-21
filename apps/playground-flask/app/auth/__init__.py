"""The SelfAuth core: the rules, with no HTTP in them. It is tested by the conformance suite;
read it as much as you like, but do not edit it."""

from . import errors, store
from .authz import (
    ADMIN_ROLE, PolicyRegistry, Resource, Subject, known_permissions, owner_filter, ownership_policy,
    role_definitions,
)
from .clock import Clock, ManualClock, SystemClock, iso
from .errors import AuthError
from .logger import Logger, MemoryLogSink
from .mailer import DevConsoleMailer, EmailMessage, Mailer, MemoryMailer
from .password import PasswordHasher
from .ratelimit import MemoryRateLimitStore, RateLimiter, RateLimitStore
from .service import Context, Deps, IssuedSession, RequestContext, Service
from .store import EmailTaken, Store

__all__ = [
    "ADMIN_ROLE", "AuthError", "Clock", "Context", "Deps", "DevConsoleMailer", "EmailMessage", "EmailTaken",
    "IssuedSession", "Logger", "Mailer", "ManualClock", "MemoryLogSink", "MemoryMailer", "MemoryRateLimitStore",
    "PasswordHasher", "PolicyRegistry", "RateLimiter", "RateLimitStore", "RequestContext", "Resource", "Service",
    "Store", "Subject", "SystemClock", "errors", "iso", "known_permissions", "owner_filter", "ownership_policy",
    "role_definitions", "store",
]
