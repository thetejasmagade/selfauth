import { randomUUID } from "node:crypto";
import { ownerFilter, ownershipPolicy, type Auth } from "../auth/index.ts";
import type { RouteHandler } from "../auth/next/index.ts";
import { HttpError } from "../http/errors.ts";

/**
 * Example application module showing how app routes use SelfAuth: a guard per route, ownership
 * checks loaded server-side, and list filtering in the query. Business logic stays outside the
 * auth core. The notes live in memory; replace this with your own table.
 *
 * The route files (src/app/api/notes/...) only pick one of the handlers from `notesRoutes`.
 */
export interface Note {
  id: string;
  ownerId: string;
  text: string;
}

// One copy for the whole process, because Next.js may load this module once per route.
const KEY = Symbol.for("selfauth.notes");
type Holder = { [KEY]?: Map<string, Note> };
const notes = (): Map<string, Note> => {
  const holder = globalThis as Holder;
  return (holder[KEY] ??= new Map());
};

function registerNotesPolicy(auth: Auth): void {
  // Registering a type again replaces its policy, so building the handlers twice is fine.
  auth.policies.register(
    "note",
    ownershipPolicy(async (id) => {
      const note = notes().get(id);
      return note ? { type: "note", id: note.id, ownerId: note.ownerId } : null;
    }),
  );
}

export function notesRoutes(auth: Auth): {
  create: RouteHandler;
  list: RouteHandler;
  one: RouteHandler;
} {
  registerNotesPolicy(auth);
  return {
    create: auth.protect(auth.requirePermission("notes.create"), async (req, call) => {
      const text = (await auth.json(req))["text"];
      if (typeof text !== "string" || text.length === 0 || text.length > 2000) {
        throw new HttpError(400, "VALIDATION_FAILED", "text is required (max 2000 characters).");
      }
      const note: Note = { id: randomUUID(), ownerId: call.auth.userId, text };
      notes().set(note.id, note);
      return Response.json({ note }, { status: 201 });
    }),
    list: auth.protect(auth.requirePermission("notes.view"), (_req, call) => {
      const filter = ownerFilter(call.auth, "notes.view");
      const visible = [...notes().values()].filter(
        (n) => !filter?.ownerId || n.ownerId === filter.ownerId,
      );
      return Response.json({ notes: visible });
    }),
    one: auth.protect(
      auth.authorizeResource("notes.view", (_req, call) => ({
        type: "note",
        id: String(call.params["id"]),
      })),
      (_req, call) => Response.json({ note: notes().get(String(call.params["id"])) }),
    ),
  };
}
