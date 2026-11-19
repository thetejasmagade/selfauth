import type express from "express";
import type { Auth } from "../auth/index.ts";
import type { Database } from "../db/store.ts";
import { mountNotes } from "./notes.ts";

/**
 * Application routes. The playground mounts the in-memory notes example; `db` is the database
 * client for your own tables (undefined on the in-memory store).
 */
export function mountRoutes(app: express.Express, auth: Auth, _db: Database | undefined): void {
  mountNotes(app, auth);
}
