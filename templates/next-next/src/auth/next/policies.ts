import {
  PolicyRegistry,
  type Decision,
  type ResourcePolicy,
  type Subject,
} from "../core/authorization.ts";

/**
 * A policy registry whose `register` replaces an earlier policy for the same type instead of
 * refusing it. In development Next.js evaluates a route file again after every edit, and the
 * SelfAuth instance (and its registry) outlives that, so a route that registers its policy when
 * its handler is built would otherwise fail on the second build.
 */
export class HotReloadPolicyRegistry extends PolicyRegistry {
  readonly #policies = new Map<string, ResourcePolicy>();

  override register(type: string, policy: ResourcePolicy): this {
    this.#policies.set(type, policy);
    return this;
  }

  // The same decision as PolicyRegistry.decide; a test keeps the two in step.
  override async decide(
    subject: Subject,
    action: string,
    type: string,
    id: string,
  ): Promise<Decision> {
    const policy = this.#policies.get(type);
    if (!policy) return "deny";
    const resource = await policy.load(id);
    // Hide existence from subjects who may not see it (AUTHZ-RES-004).
    if (!resource) return "not_found";
    return policy.authorize(subject, action, resource) ? "allow" : "not_found";
  }
}
