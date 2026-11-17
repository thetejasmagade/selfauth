import type { FastifyInstance } from "fastify";
import type { Auth } from "../auth/index.ts";
import { mountNotes } from "./notes.ts";

/** Application routes. The playground mounts the notes example. */
export function mountRoutes(app: FastifyInstance, auth: Auth): void {
  mountNotes(app, auth);
}
