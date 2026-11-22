import type { NextConfig } from "next";

const config: NextConfig = {
  // Do not announce the framework (the same as every other SelfAuth backend).
  poweredByHeader: false,
  // The backend sees /auth/login/ and /auth/login as one route; Next must not redirect an API call.
  skipTrailingSlashRedirect: true,
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    },
  ],
};

export default config;
