// Copies selfauth.config.json (project root) into server/ and client/, so each package imports a
// file inside its own folder. Runs before dev, build, test and typecheck, and as `npm run sync`.
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "selfauth.config.json");
if (existsSync(source)) {
  const text = readFileSync(source, "utf8");
  const password = JSON.parse(text).password;
  for (const key of ["minLength", "maxLength"]) {
    if (!Number.isInteger(password?.[key])) {
      throw new Error(`selfauth.config.json: password.${key} must be a whole number`);
    }
  }
  for (const folder of ["server/src/config", "client/src"]) {
    const target = join(root, folder, "selfauth.config.json");
    if (!existsSync(target) || readFileSync(target, "utf8") !== text) copyFileSync(source, target);
  }
}
