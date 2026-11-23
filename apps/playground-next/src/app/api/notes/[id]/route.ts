import { withAuth } from "../../../../lib/auth.ts";
import { notesRoutes } from "../../../../lib/notes.ts";

export const dynamic = "force-dynamic";

export const GET = withAuth((auth) => notesRoutes(auth).one);
export const OPTIONS = withAuth((auth) => auth.preflight);
