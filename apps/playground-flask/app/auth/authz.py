"""Role-based authorization and resource policies (AUTHORIZATION_SPEC)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Protocol

from ..config import SYSTEM_PERMISSIONS, Config

ADMIN_ROLE = "admin"


@dataclass(frozen=True)
class Subject:
    """The authenticated subject, always derived server-side (AUTHZ-CORE-003)."""

    user_id: str
    roles: tuple[str, ...] = ()
    permissions: frozenset[str] = field(default_factory=frozenset)

    def has(self, permission: str) -> bool:
        return permission in self.permissions


def role_definitions(config: Config) -> dict[str, list[str]]:
    """Maps role -> permissions as stored; admin always holds every system permission (AUTHZ-RBAC-004)."""
    roles = {name: list(dict.fromkeys(perms)) for name, perms in config.authorization.roles.items()}
    roles[ADMIN_ROLE] = list(dict.fromkeys([*roles.get(ADMIN_ROLE, []), *SYSTEM_PERMISSIONS]))
    return roles


def known_permissions(config: Config) -> frozenset[str]:
    """Every permission a check may reference (AUTHZ-PERM-004)."""
    return frozenset([*config.authorization.permissions, *SYSTEM_PERMISSIONS])


@dataclass(frozen=True)
class Resource:
    """Loaded from storage, never from the request (AUTHZ-RES-003)."""

    type: str
    id: str
    owner_id: str = ""  # "" when the resource has no owner


class ResourcePolicy(Protocol):
    def load(self, resource_id: str) -> Resource | None: ...

    def authorize(self, subject: Subject, action: str, resource: Resource) -> bool: ...


ALLOW, DENY, NOT_FOUND = "allow", "deny", "not_found"


class PolicyRegistry:
    """authorize(subject, action, resource) (AUTHZ-RES-001). Unregistered types are denied (AUTHZ-RES-002)."""

    def __init__(self) -> None:
        self._policies: dict[str, ResourcePolicy] = {}

    def register(self, resource_type: str, policy: ResourcePolicy) -> None:
        """Raises on a duplicate, which is a programming error found at startup."""
        if resource_type in self._policies:
            raise ValueError(f"policy for {resource_type!r} already registered")
        self._policies[resource_type] = policy

    def decide(self, subject: Subject, action: str, resource_type: str, resource_id: str) -> str:
        policy = self._policies.get(resource_type)
        if policy is None:
            return DENY
        resource = policy.load(resource_id)
        # Hide existence from subjects who may not see it (AUTHZ-RES-004).
        if resource is None:
            return NOT_FOUND
        return ALLOW if policy.authorize(subject, action, resource) else NOT_FOUND


class _Ownership:
    def __init__(self, load: Callable[[str], Resource | None]) -> None:
        self._load = load

    def load(self, resource_id: str) -> Resource | None:
        return self._load(resource_id)

    def authorize(self, subject: Subject, action: str, resource: Resource) -> bool:
        if subject.has(f"{action}_any"):
            return True
        return subject.has(action) and resource.owner_id != "" and resource.owner_id == subject.user_id


def ownership_policy(load: Callable[[str], Resource | None]) -> ResourcePolicy:
    """Allows the action if the subject holds `<action>_any`, or holds the action and owns the
    resource (AUTHZ-RES-005)."""
    return _Ownership(load)


def owner_filter(subject: Subject, action: str) -> tuple[str | None, bool, bool]:
    """The query filter for list operations (AUTHZ-RES-006): (owner_id, all, ok). `all` means the
    subject may list every owner's rows; otherwise filter by owner_id in the query. `ok` is False
    when the subject may not list at all."""
    if subject.has(f"{action}_any"):
        return None, True, True
    if subject.has(action):
        return subject.user_id, False, True
    return None, False, False
