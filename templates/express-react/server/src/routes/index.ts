import type express from "express";
import type { Auth } from "../auth/index.ts";
import { mountNotes } from "./notes.ts";

/** Application routes. The playground mounts the notes example. */
export function mountRoutes(app: express.Express, auth: Auth): void {
  mountNotes(app, auth);
}
