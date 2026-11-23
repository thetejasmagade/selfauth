import { AuthError } from "../../../auth/core/errors.ts";
import { withAuth } from "../../../lib/auth.ts";

// Anything under /api that has no route of its own gets the SelfAuth error envelope instead of
// Next.js's HTML 404 page.
export const dynamic = "force-dynamic";

const notFound = withAuth((auth) =>
  auth.route(() => {
    throw new AuthError("NOT_FOUND", "Not found.");
  }),
);

export {
  notFound as GET,
  notFound as POST,
  notFound as PUT,
  notFound as PATCH,
  notFound as DELETE,
  notFound as OPTIONS,
};
