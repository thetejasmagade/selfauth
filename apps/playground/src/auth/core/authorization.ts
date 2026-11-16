import type { SelfAuthConfig } from "@selfauth/spec";

/**
 * System permissions held by the admin role (AUTHORIZATION_SPEC §5). Copied
 * from the spec so the application has no runtime SelfAuth dependency; a test
 * asserts the copy matches @selfauth/spec.
 */
export const SYSTEM_PERMISSIONS = [
  "auth.users.read",
  "auth.users.manage",
  "auth.sessions.manage",
  "auth.roles.assign",
  "auth.roles.manage",
  "auth.audit.read",
] as const;

export const ADMIN_ROLE = "admin";

/** The authenticated subject, always derived server-side (AUTHZ-CORE-003). */
export interface Subject {
  userId: string;
  roles: readonly string[];
  permissions: ReadonlySet<string>;
}

/** Role → permissions as stored; admin always holds every system permission (AUTHZ-RBAC-004). */
export function roleDefinitions(config: SelfAuthConfig): Map<string, string[]> {
  const roles = new Map<string, string[]>();
  for (const [name, perms] of Object.entries(config.authorization.roles)) {
    roles.set(name, [...new Set(perms)]);
  }
  const admin = new Set([...(roles.get(ADMIN_ROLE) ?? []), ...SYSTEM_PERMISSIONS]);
  roles.set(ADMIN_ROLE, [...admin]);
  return roles;
}

/** Every permission a check may reference (AUTHZ-PERM-004). */
export function knownPermissions(config: SelfAuthConfig): Set<string> {
  return new Set([...config.authorization.permissions, ...SYSTEM_PERMISSIONS]);
}

/** A resource loaded from storage — never from the request (AUTHZ-RES-003). */
export interface Resource {
  type: string;
  id: string;
  ownerId?: string | null;
  [attribute: string]: unknown;
}

export interface ResourcePolicy {
  load(id: string): Promise<Resource | null>;
  authorize(subject: Subject, action: string, resource: Resource): boolean;
}

export type Decision = "allow" | "deny" | "not_found";

/**
 * Registry implementing `authorize(subject, action, resource)` (AUTHZ-RES-001).
 * Unregistered resource types are denied (AUTHZ-RES-002).
 */
export class PolicyRegistry {
  private readonly policies = new Map<string, ResourcePolicy>();

  register(type: string, policy: ResourcePolicy): this {
    if (this.policies.has(type)) throw new Error(`policy for '${type}' already registered`);
    this.policies.set(type, policy);
    return this;
  }

  async decide(subject: Subject, action: string, type: string, id: string): Promise<Decision> {
    const policy = this.policies.get(type);
    if (!policy) return "deny";
    const resource = await policy.load(id);
    // Hide existence from subjects who may not see it (AUTHZ-RES-004).
    if (!resource) return "not_found";
    return policy.authorize(subject, action, resource) ? "allow" : "not_found";
  }
}

/**
 * Ownership helper (AUTHZ-RES-005): allowed if the subject holds `action` and
 * owns the resource, or holds `${action}_any` when the project defines it.
 */
export function ownershipPolicy(load: (id: string) => Promise<Resource | null>): ResourcePolicy {
  return {
    load,
    authorize(subject, action, resource) {
      if (subject.permissions.has(`${action}_any`)) return true;
      return (
        subject.permissions.has(action) &&
        resource.ownerId != null &&
        resource.ownerId === subject.userId
      );
    },
  };
}

/**
 * Query filter for list operations (AUTHZ-RES-006): `undefined` owner means
 * the subject may list every owner's rows; otherwise filter by owner in the query.
 */
export function ownerFilter(subject: Subject, action: string): { ownerId?: string } | null {
  if (subject.permissions.has(`${action}_any`)) return {};
  if (subject.permissions.has(action)) return { ownerId: subject.userId };
  return null;
}
