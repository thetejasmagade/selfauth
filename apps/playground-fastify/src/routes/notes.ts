import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ownerFilter, ownershipPolicy, type Auth } from "../auth/index.ts";
import { HttpError } from "../http/errors.ts";

/**
 * Example application module showing how app routes use SelfAuth: a guard per
 * route, ownership checks loaded server-side, and list filtering in the query.
 * Business logic stays outside the auth core.
 */
interface Note {
  id: string;
  ownerId: string;
  text: string;
}

export function mountNotes(app: FastifyInstance, auth: Auth): void {
  const notes = new Map<string, Note>();
  auth.policies.register(
    "note",
    ownershipPolicy(async (id) => {
      const note = notes.get(id);
      return note ? { type: "note", id: note.id, ownerId: note.ownerId } : null;
    }),
  );

  const routes = auth.protectedRoutes(app, "/api/notes");
  routes.post("/", auth.requirePermission("notes.create"), async (req, reply) => {
    const text = (req.body as { text?: unknown } | undefined)?.text;
    if (typeof text !== "string" || text.length === 0 || text.length > 2000) {
      throw new HttpError(400, "VALIDATION_FAILED", "text is required (max 2000 characters).");
    }
    const note: Note = { id: randomUUID(), ownerId: auth.context(req)!.userId, text };
    notes.set(note.id, note);
    return reply.code(201).send({ note });
  });
  routes.get("/", auth.requirePermission("notes.view"), async (req) => {
    const filter = ownerFilter(auth.context(req)!, "notes.view");
    const visible = [...notes.values()].filter(
      (n) => !filter?.ownerId || n.ownerId === filter.ownerId,
    );
    return { notes: visible };
  });
  routes.get(
    "/:id",
    auth.authorizeResource("notes.view", (req) => ({
      type: "note",
      id: (req.params as { id: string }).id,
    })),
    async (req) => ({ note: notes.get((req.params as { id: string }).id) }),
  );
}
