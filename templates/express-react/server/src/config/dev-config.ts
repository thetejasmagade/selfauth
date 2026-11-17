import type { SelfAuthConfig } from "../auth/types.ts";

/**
 * Local http development cannot use `__Host-` / Secure cookies, so the dev
 * server overrides only the cookie settings (SEC-COOKIE-003 forbids this in production).
 */
export function localDevelopmentConfig(base: SelfAuthConfig): SelfAuthConfig {
  return {
    ...base,
    authentication: {
      ...base.authentication,
      sessions: {
        ...base.authentication.sessions,
        cookie: { ...base.authentication.sessions.cookie, name: "dev_session", secure: false },
      },
    },
  };
}
