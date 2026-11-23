# Documentation

**Installing**
- With the CLI: [`packages/cli/README.md`](../packages/cli/README.md)
- By hand, without the CLI or an LLM: [manual integration](manual-integration.md)
  and [`templates/`](../templates/README.md)
- With a coding agent: [`integrations/`](../integrations/README.md)

**Reference**
- [API reference](api/README.md): HTTP, server and client
- [Database schema and migrations](database.md)
- [Adding SelfAuth to an existing project](existing-projects.md): other folder layouts, monorepos, a frontend elsewhere
- [Data retention after account deletion](data-retention.md)
- [Conformance and support matrix](conformance.md) (Express), [for Fastify](conformance-fastify.md) [for Next.js](conformance-next.md), [for Gin (Go)](conformance-gin.md) and [for Flask (Python)](conformance-flask.md)
- [Security review](security-review.md)
- [Specification review checklist](spec-review.md)
- [Customization and extension points](customization.md)
- [Frontend deployment](frontend-deployment.md): same origin, subdomains,
  cross site
- [Specification](../packages/spec/specs/), the normative behaviour

**Maintaining**
- [Upgrading](upgrading.md)
- [Releasing](releasing.md) (maintainers)
- [Architecture decisions](../DECISIONS.md)
