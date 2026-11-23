import type { SelfAuthConfig } from "../auth/types.ts";

/**
 * SelfAuth configuration: behavior only, never secrets (CONF-FILE-002).
 * Every default is a secure starting point and can be changed within the
 * bounds in CONFIGURATION_SPEC.md. Check changes with `npx selfauth validate`.
 *
 * http.trustProxy: Next.js does not expose the connection address, so SelfAuth reads it from
 * X-Forwarded-For. The number is how many proxies sit in front of the app (a hosting platform
 * or a reverse proxy counts as one). With no proxy at all the header comes from the client, and
 * the per-address rate limits can be bypassed (the per-account limits still apply).
 */
export const config: SelfAuthConfig = {
  "specVersion": "0.1",
  "adapter": {
    "backend": "next",
    "frontend": "none",
    "database": "postgresql",
    "orm": "prisma"
  },
  "authentication": {
    "methods": [
      "password"
    ],
    "emailVerification": {
      "mode": "required",
      "tokenTtlMinutes": 1440
    },
    "registration": {
      "revealExistingEmail": false,
      "signInAfterRegistration": false
    },
    "passwordReset": {
      "tokenTtlMinutes": 30
    },
    "password": {
      "minLength": 8,
      "maxLength": 128,
      "rejectCommon": true,
      "hashing": {
        "memoryKiB": 19456,
        "iterations": 2,
        "parallelism": 1
      }
    },
    "sessions": {
      "strategy": "database",
      "idleTimeoutMinutes": 10080,
      "absoluteTimeoutMinutes": 43200,
      "touchIntervalSeconds": 60,
      "cookie": {
        "name": "__Host-session",
        "sameSite": "lax",
        "secure": true
      }
    },
    "rateLimit": {
      "login": {
        "perAccount": {
          "limit": 5,
          "windowSeconds": 900
        },
        "perAddress": {
          "limit": 100,
          "windowSeconds": 900
        }
      },
      "passwordChange": {
        "perAccount": {
          "limit": 5,
          "windowSeconds": 900
        },
        "perAddress": {
          "limit": 100,
          "windowSeconds": 900
        }
      },
      "register": {
        "perAccount": {
          "limit": 3,
          "windowSeconds": 900
        },
        "perAddress": {
          "limit": 20,
          "windowSeconds": 900
        }
      },
      "passwordResetRequest": {
        "perAccount": {
          "limit": 3,
          "windowSeconds": 900
        },
        "perAddress": {
          "limit": 20,
          "windowSeconds": 900
        }
      },
      "verificationResend": {
        "perAccount": {
          "limit": 3,
          "windowSeconds": 900
        },
        "perAddress": {
          "limit": 20,
          "windowSeconds": 900
        }
      }
    }
  },
  "authorization": {
    "strategy": "rbac",
    "permissions": [],
    "roles": {
      "user": [],
      "admin": []
    },
    "defaultRoles": [
      "user"
    ],
    "reauthenticationWindowMinutes": 15
  },
  "http": {
    "bodyLimitBytes": 16384,
    "basePath": "/auth",
    "trustedOrigins": [],
    "trustProxy": 1,
    "csrf": {
      "mode": "header",
      "headerName": "X-SelfAuth-CSRF"
    }
  }
};
