import { withAuth } from "../../../lib/auth.ts";
import { notesRoutes } from "../../../lib/notes.ts";

export const dynamic = "force-dynamic";

export const POST = withAuth((auth) => notesRoutes(auth).create);
export const GET = withAuth((auth) => notesRoutes(auth).list);
export const OPTIONS = withAuth((auth) => auth.preflight);
