import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  fileDrift,
  isGoProject,
  isPythonProject,
  loadConfig,
  loadManifest,
  packageLabel,
  projectDirs,
  projectPath,
  readEnvFile,
} from "../project.js";
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

  if (manifest.options?.layout === "frontend" || manifest.options?.layout === "client") {
    // The frontend module has no configuration, mailer or database: only its files can drift.
    const drift = await fileDrift(dir, manifest);
    for (const m of drift.missing) report.warnings.push(`generated file deleted: ${m}`);
    if (drift.modified.length)
      report.notes.push(
        `you changed ${drift.modified.length} generated file(s): ${drift.modified.join(", ")}`,
      );
    report.notes.push(
      manifest.options.layout === "client"
        ? `${manifest.options.frontend} frontend, templates ${manifest.templateVersion ?? "unknown"}; only its generated files are checked for changes`
        : `frontend module (${manifest.options.frontend}) in ${manifest.options.srcDir}/selfauth, templates ${manifest.templateVersion ?? "unknown"}; the backend's checks run with \`selfauth doctor\` in the backend folder`,
    );
    return report;
  }

  const { config, errors } = await loadConfig(dir, manifest);
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
    if (config.adapter.backend === "next" && config.http.trustProxy === false)
      report.warnings.push(
        "http.trustProxy is false: Next.js route handlers cannot see the connection address, so the per-address rate limits share one bucket. Set it to the number of proxies in front of the app (1 behind a hosting platform or a reverse proxy)",
      );
    if (config.adapter.database === "memory")
      report.warnings.push(
        "in-memory store: data is lost on restart; use PostgreSQL, MySQL, SQLite or MongoDB in production",
      );
    if (config.http.csrf.mode === "token") {
      const env = await readEnvFile(dir, ".env");
      if (!env["SELFAUTH_CSRF_SECRET"])
        report.warnings.push(
          "http.csrf.mode is 'token' but SELFAUTH_CSRF_SECRET is not set in .env",
        );
    }
  }

  const mailer = join(dir, projectPath(manifest, "src/email/mailer.ts"));
  const mailerFunction = isGoProject(manifest)
    ? "NewMailer"
    : isPythonProject(manifest)
      ? "create_mailer"
      : "createMailer()";
  if (existsSync(mailer) && /no email provider configured/i.test(await readFile(mailer, "utf8"))) {
    report.warnings.push(
      `no email provider yet: implement ${mailerFunction} in ${projectPath(manifest, "src/email/mailer.ts")} before production`,
    );
  }
  // A full-stack project keeps one .gitignore at its root, above the server package.
  const gitignoreFiles = [dir, ...(manifest.options?.layout === "server" ? [dirname(dir)] : [])]
    .map((d) => join(d, ".gitignore"))
    .filter((f) => existsSync(f));
  const gitignore = (await Promise.all(gitignoreFiles.map((f) => readFile(f, "utf8")))).join("\n");
  if (!/^\.env$/m.test(gitignore)) report.errors.push(".env is not git-ignored (SEC-SECRET-002)");
  const env = await readEnvFile(dir, ".env");
  if (existsSync(join(dir, ".env"))) {
    if (!env["SELFAUTH_APP_BASE_URL"])
      report.errors.push(".env: SELFAUTH_APP_BASE_URL is missing (email links need it)");
    if (manifest.database.type !== "memory" && !env["DATABASE_URL"])
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

export async function doctor(
  dirArg: string | undefined,
  opts: { json?: boolean } = {},
): Promise<number> {
  const base = resolve(dirArg ?? ".");
  const dirs = await projectDirs(dirArg);
  // One report for one package; for a full-stack project the packages' findings are merged,
  // each prefixed with its folder.
  const report: DoctorReport = { errors: [], warnings: [], notes: [] };
  for (const dir of dirs) {
    const r = await diagnose(dir);
    const prefix = packageLabel(base, dirs, dir);
    report.errors.push(...r.errors.map((m) => prefix + m));
    report.warnings.push(...r.warnings.map((m) => prefix + m));
    report.notes.push(...r.notes.map((m) => prefix + m));
  }
  if (opts.json) {
    say(JSON.stringify({ ok: !report.errors.length, ...report }, null, 2));
    return report.errors.length ? 1 : 0;
  }
  say(`SelfAuth doctor → ${base}`);
  for (const e of report.errors) fail(e);
  for (const w of report.warnings) warn(w);
  for (const n of report.notes) info(n);
  if (!report.errors.length && !report.warnings.length) ok("No problems found.");
  say(`\n${report.errors.length} error(s), ${report.warnings.length} warning(s).`);
  return report.errors.length ? 1 : 0;
}
