import { readFileSync } from "node:fs";

/** Read at runtime: package.json sits outside the TypeScript rootDir. */
export const CLI_VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
