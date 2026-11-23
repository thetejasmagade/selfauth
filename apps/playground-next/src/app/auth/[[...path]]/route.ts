import { withAuth } from "../../../lib/auth.ts";

// Every authentication route (/auth/login, /auth/register, ...) is served from here. The folder
// must match `http.basePath` in selfauth.config.ts.
export const dynamic = "force-dynamic";

const handle = withAuth((auth) => auth.handler);

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as OPTIONS,
};
