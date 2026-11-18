import type { Driver, DriverFactory, HttpRequest } from "@selfauth/conformance";
import type { FastifyInstance } from "fastify";
import {
  knownPermissions,
  ownerFilter,
  ownershipPolicy,
} from "../../src/auth/core/authorization.ts";
import { PasswordHasher } from "../../src/auth/core/password.ts";
import type { AccountState } from "../../src/auth/core/store.ts";
import { normalizeEmail } from "../../src/auth/core/email.ts";
import type { Auth } from "../../src/auth/index.ts";
import type { PrismaAuthStore } from "../../src/auth/stores/prisma.ts";
import { buildTestApp, type StoreKind } from "../helpers.ts";
import { readSecurityEvents } from "./events.ts";
import { request } from "../http.ts";

/** Hashing fixtures once per password keeps the suite fast. */
const fixtureHashes = new Map<string, Promise<string>>();

interface FixtureResource {
  type: string;
  id: string;
  ownerId: string;
}

type Row = Record<string, unknown>;

/** Logical entities (DATA_MODEL.md) read back from PostgreSQL for `inspectStorage`. */
async function inspectPrisma(store: PrismaAuthStore, entity: string): Promise<Row[]> {
  const db = store.db;
  switch (entity) {
    case "user": {
      const users = await db.authUser.findMany({
        include: { roles: { include: { role: true } } },
        orderBy: { createdAt: "asc" },
      });
      return users.map(({ roles, ...u }) => ({ ...u, roles: roles.map((r) => r.role.name) }));
    }
    case "credential":
      return db.authCredential.findMany({ orderBy: { createdAt: "asc" } });
    case "session":
      return db.authSession.findMany({ orderBy: { createdAt: "asc" } });
    case "passwordResetToken":
      return db.authPasswordResetToken.findMany({ orderBy: { createdAt: "asc" } });
    case "emailVerificationToken":
      return db.authEmailVerificationToken.findMany({ orderBy: { createdAt: "asc" } });
    default:
      throw new Error(`unknown entity '${entity}'`);
  }
}

async function mutatePrisma(
  store: PrismaAuthStore,
  entity: string,
  where: Row,
  set: Row,
): Promise<void> {
  if (entity !== "user" && entity !== "session")
    throw new Error(`mutateStorage: unsupported entity '${entity}'`);
  // Test-only escape hatch: field names come from the case and are checked by Prisma at runtime.
  if (entity === "user")
    await store.db.authUser.updateMany({ where: where as never, data: set as never });
  else await store.db.authSession.updateMany({ where: where as never, data: set as never });
}

/** Conformance driver for the Fastify reference implementation (CONFORMANCE.md). */
export function playgroundDriver(storeKind: StoreKind): DriverFactory {
  return (options) => createPlaygroundDriver(storeKind, options);
}

const createPlaygroundDriver = async (
  storeKind: StoreKind,
  { config, environment, given }: Parameters<DriverFactory>[0],
): Promise<Driver> => {
  const resources: FixtureResource[] = [];
  let lastListFiltered: boolean | undefined;

  const mountHarness = (app: FastifyInstance, auth: Auth) => {
    const routes = auth.protectedRoutes(app, "/__conformance");
    const ok = async () => ({ ok: true });
    const known = knownPermissions(config);
    const param = (req: { params: unknown }, name: string) =>
      (req.params as Record<string, string>)[name] as string;
    for (const permission of known) {
      routes.post(`/permission/${permission}`, auth.requirePermission(permission), ok);
      routes.post(
        `/resource/${permission}/:type/:id`,
        auth.authorizeResource(permission, (req) => ({
          type: param(req, "type"),
          id: param(req, "id"),
        })),
        ok,
      );
    }
    routes.post("/unconfigured", ok); // no guard → must be denied (AUTHZ-CORE-001)
    if (known.has("orders.view")) {
      routes.get("/list/order", auth.requirePermission("orders.view"), async (req) => {
        const filter = ownerFilter(auth.context(req)!, "orders.view") ?? { ownerId: "" };
        lastListFiltered = filter.ownerId !== undefined;
        // The filter is applied by the query, not after loading everything (AUTHZ-RES-006).
        const ids = resources
          .filter(
            (r) =>
              r.type === "order" && (filter.ownerId === undefined || r.ownerId === filter.ownerId),
          )
          .map((r) => r.id);
        return { ids };
      });
    }
    auth.policies.register(
      "order",
      ownershipPolicy(async (id) => {
        const r = resources.find((x) => x.type === "order" && x.id === id);
        return r ? { type: r.type, id: r.id, ownerId: r.ownerId } : null;
      }),
    );
    app.get("/__conformance/fault", async () => {
      throw new Error("SELECT * FROM auth_users failed at db.ts:12:3");
    });
  };

  const t = await buildTestApp({
    config,
    nodeEnv: environment === "production" ? "production" : "test",
    mount: mountHarness,
    store: storeKind,
  });
  const { store, mailer, clock, logs } = t;

  // Fixtures are written directly to storage, as a seed script would.
  const hasher = new PasswordHasher(config.authentication.password.hashing);
  const fixtures: Record<string, { id: string }> = {};
  for (const g of given) {
    if ("resource" in g) continue;
    const hashPromise = fixtureHashes.get(g.password) ?? hasher.hash(g.password);
    fixtureHashes.set(g.password, hashPromise);
    const now = clock.now();
    const state = g.state as AccountState;
    const user = await store.createUser({
      user: {
        id: crypto.randomUUID(),
        email: g.email,
        emailNormalized: normalizeEmail(g.email),
        emailVerifiedAt: state === "pending" ? null : now,
        state: state === "deleted" ? "active" : state,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      passwordHash: await hashPromise,
      roles: g.roles ?? config.authorization.defaultRoles,
    });
    if (state === "deleted") {
      await store.updateUser(user.id, {
        state: "deleted",
        deletedAt: now,
        email: null,
        emailNormalized: null,
      });
      await store.deleteCredentials(user.id);
    }
    fixtures[g.user] = { id: user.id };
  }
  for (const g of given) {
    if (!("resource" in g)) continue;
    const owner = fixtures[g.resource.owner];
    if (!owner) throw new Error(`resource owner '${g.resource.owner}' is not a fixture user`);
    resources.push({ type: g.resource.type, id: g.resource.id, ownerId: owner.id });
    fixtures[g.resource.id] = { id: g.resource.id };
  }

  const driver: Driver = {
    fixtures,
    async request(req: HttpRequest) {
      const agent = request(t.app);
      const method = req.method.toLowerCase() as
        "get" | "post" | "put" | "patch" | "delete" | "options";
      let pending = agent[method](req.path).set(req.headers);
      const hasBody = req.body !== undefined && method !== "get" && method !== "options";
      if (hasBody) pending = pending.send(req.body as string | object);
      const res = await pending;
      const headers: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(res.headers)) headers[k] = v as string | string[];
      headers["set-cookie"] = res.headers["set-cookie"] ?? [];
      const body =
        res.body && typeof res.body === "object" && Object.keys(res.body).length === 0 && !res.text
          ? null
          : res.body;
      return { status: res.status, headers, body };
    },
    advanceClock(ms) {
      clock.advance(ms);
    },
    async lastEmail(to) {
      const mail = mailer.lastTo(to);
      return mail ? { kind: mail.kind, token: mail.token, link: mail.link } : null;
    },
    async inspectStorage(entity) {
      if (t.memory) return t.memory.inspect(entity);
      return inspectPrisma(t.prisma!, entity);
    },
    async mutateStorage(entity, where, set) {
      if (t.memory) {
        t.memory.mutate(entity, (r) => Object.entries(where).every(([k, v]) => r[k] === v), set);
      } else {
        await mutatePrisma(t.prisma!, entity, where, set);
      }
    },
    async events() {
      if (t.memory) return t.memory.events as unknown as Record<string, unknown>[];
      return readSecurityEvents(t.prisma!);
    },
    close: t.close,
    async logs() {
      return logs.lines;
    },
    lastListQueryFiltered: () => lastListFiltered,
  };
  return driver;
};
