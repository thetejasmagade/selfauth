import type { NextConfig } from "next";

const config: NextConfig = {
  // Native and database packages are loaded by Node at run time, not bundled.
  serverExternalPackages: [
    "@node-rs/argon2",
    "@prisma/client",
    "@prisma/adapter-pg",
    "@prisma/adapter-better-sqlite3",
    "@prisma/adapter-mariadb",
    "better-sqlite3",
    "mongoose",
    "pg",
  ],
  // /auth/login/ and /auth/login are the same route; Next must not redirect an API call.
  skipTrailingSlashRedirect: true,
  // Do not announce the framework (the same as every other SelfAuth backend).
  poweredByHeader: false,
  // Headers for every response (pages and routes).
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
