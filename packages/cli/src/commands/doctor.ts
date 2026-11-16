import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileDrift, loadConfig, loadManifest, readEnvFile } from "../project.js";
import { fail, info, ok, say, warn } from "./output.js";

export interface DoctorReport {
  errors: string[];
  warnings: string[];
  notes: string[];
}

/** Configuration and production-readiness checks. Pure: returns findings. */
export async function diagnose(dir: string): Promise<DoctorReport> {
  const report: DoctorReport = { errors: [], warnings: [], notes: [] };
  const [major, minor] = process.versions.node.split(".").map(Number) as [number, number];
  if (major < 22 || (major === 22 && minor < 18))
    report.errors.push(`Node.js ${process.versions.node} is too old; SelfAuth needs ≥ 22.18`);

  const manifest = await loadManifest(dir).catch((e: Error) => {
    report.errors.push(`selfauth.manifest.json is invalid: ${e.message}`);
    return null;
  });
  if (!manifest) {
    if (!report.errors.length)
      report.errors.push("not a SelfAuth project (selfauth.manifest.json not found)");
    return report;
  }

  const { config, errors } = await loadConfig(dir);
  report.errors.push(...errors);
  if (config) {
    const a = config.authentication;
    if (a.registration.revealExistingEmail)
      report.warnings.push(
        "registration.revealExistingEmail is on: sign-up reveals which emails have accounts (SEC-ENUM-004)",
      );
    if (a.registration.signInAfterRegistration)
      report.warnings.push("registration.signInAfterRegistration is on (SEC-ENUM-004)");
    if (a.emailVerification.mode !== "required")
      report.warnings.push(
        `emailVerification.mode is '${a.emailVerification.mode}': accounts work before the email is proven`,
      );
    if (!a.sessions.cookie.secure)
      report.warnings.push(
        "sessions.cookie.secure is false: the server will refuse to start in production (SEC-COOKIE-003)",
      );
    if (a.sessions.cookie.sameSite === "none")
      report.warnings.push(
        "sessions.cookie.sameSite is 'none': cross-site deployment, token-mode CSRF required (docs/frontend-deployment.md)",
      );
    if (a.password.minLength < 12)
      report.warnings.push(
        `password.minLength is ${a.password.minLength}; 12 or more is recommended`,
      );
    if (config.adapter.database === "memory")
      report.warnings.push(
        "in-memory store: data is lost on restart; use PostgreSQL in production",
      );
    if (config.http.csrf.mode === "token") {
      const env = await readEnvFile(dir, ".env");
      if (!env["SELFAUTH_CSRF_SECRET"])
        report.warnings.push(
          "http.csrf.mode is 'token' but SELFAUTH_CSRF_SECRET is not set in .env",
        );
    }
  }

  const mailer = join(dir, "src", "mailer.ts");
  if (
    existsSync(mailer) &&
    (await readFile(mailer, "utf8")).includes("No email provider configured")
  ) {
    report.warnings.push(
      "no email provider yet: implement createMailer() in src/mailer.ts before production",
    );
  }
  const gitignore = existsSync(join(dir, ".gitignore"))
    ? await readFile(join(dir, ".gitignore"), "utf8")
    : "";
  if (!/^\.env$/m.test(gitignore)) report.errors.push(".env is not git-ignored (SEC-SECRET-002)");
  const env = await readEnvFile(dir, ".env");
  if (existsSync(join(dir, ".env"))) {
    if (!env["SELFAUTH_APP_BASE_URL"])
      report.errors.push(".env: SELFAUTH_APP_BASE_URL is missing (email links need it)");
    if (manifest.database.type === "postgresql" && !env["DATABASE_URL"])
      report.warnings.push(".env: DATABASE_URL is missing");
  } else {
    report.notes.push("no .env yet (copy .env.example)");
  }

  const drift = await fileDrift(dir, manifest);
  for (const m of drift.missing) report.warnings.push(`generated file deleted: ${m}`);
  if (drift.modified.length)
    report.notes.push(
      `you changed ${drift.modified.length} generated file(s): ${drift.modified.join(", ")}`,
    );
  report.notes.push(
    `templates ${manifest.templateVersion ?? "unknown"}, spec ${manifest.specVersion}, database ${manifest.database.type}`,
  );
  return report;
}

export async function doctor(dirArg: string | undefined): Promise<number> {
  const dir = resolve(dirArg ?? ".");
  say(`SelfAuth doctor → ${dir}`);
  const report = await diagnose(dir);
  for (const e of report.errors) fail(e);
  for (const w of report.warnings) warn(w);
  for (const n of report.notes) info(n);
  if (!report.errors.length && !report.warnings.length) ok("No problems found.");
  say(`\n${report.errors.length} error(s), ${report.warnings.length} warning(s).`);
  return report.errors.length ? 1 : 0;
}
