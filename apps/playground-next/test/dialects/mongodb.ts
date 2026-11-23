/**
 * Stand-in for test/postgres.ts when the suite runs on MongoDB (scripts/dialect-conformance.mjs):
 * the conformance test only needs to know whether a database is configured.
 */
export const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];
