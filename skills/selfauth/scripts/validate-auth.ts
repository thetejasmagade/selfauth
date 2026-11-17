#!/usr/bin/env node
/* eslint-disable no-console -- command-line output for agents */
// Validates a SelfAuth integration for the selfauth skill. An agent may report the work as
// complete only when this prints `RESULT: PASS`. SKIPPED checks were not verified and must be
// reported as such.
//
//   node <skill>/scripts/validate-auth.ts [project-dir]
//        [--url http://localhost:3000] [--protected /api/orders]... [--base-path /auth]
//        [--skip-tests] [--json]
//
// Runs: selfauth validate, selfauth doctor, the project's typecheck / test / build scripts
// (the project root, which for a full-stack project runs server/ and client/), and, with --url,
// read-only probes against the running server.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  flagValues,
  parseJson,
  positional,
  readPackageJson,
  run,
  runCli,
  runScript,
} from "./cli.ts";

type Status = "PASS" | "FAIL" | "WARN" | "SKIPPED";
interface Check {
  name: string;
  status: Status;
  detail: string;
}

const argv = process.argv.slice(2);
const VALUE_FLAGS = ["--url", "--protected", "--base-path"];
const dir = resolve(positional(argv, VALUE_FLAGS)[0] ?? ".");
const url = flagValues(argv, "--url")[0];
const protectedPaths = flagValues(argv, "--protected");
const basePath = (flagValues(argv, "--base-path")[0] ?? "/auth").replace(/\/$/, "");
const checks: Check[] = [];
const add = (name: string, status: Status, detail = "") => checks.push({ name, status, detail });
const tail = (text: string, n = 15) => text.trim().split("\n").slice(-n).join("\n");

// 1. selfauth validate: config schema, generated files, Prisma schema vs. manifest.
try {
  const v = parseJson<{ ok: boolean; problems: string[]; passed: string[]; notes: string[] }>(
    runCli(dir, ["validate", dir, "--json"]),
    "selfauth validate",
  );
  add(
    "selfauth validate",
    v.ok ? "PASS" : "FAIL",
    [...(v.ok ? v.passed : v.problems), ...v.notes].join("; "),
  );
} catch (error) {
  add("selfauth validate", "FAIL", (error as Error).message);
}

// 2. selfauth doctor: errors fail; warnings are reported (they are often manual steps).
try {
  const d = parseJson<{ errors: string[]; warnings: string[]; notes: string[] }>(
    runCli(dir, ["doctor", dir, "--json"]),
    "selfauth doctor",
  );
  add(
    "selfauth doctor",
    d.errors.length ? "FAIL" : "PASS",
    d.errors.join("; ") || `${d.warnings.length} warning(s)`,
  );
  for (const w of d.warnings) add("doctor warning", "WARN", w);
} catch (error) {
  add("selfauth doctor", "FAIL", (error as Error).message);
}

// 3. The project's own scripts. A full-stack project (made by SelfAuth 0.6 or later) is an npm workspace whose root
// scripts run server/ and client/; an older one has web/ next to src/.
function projectScripts(where: string, label: string): void {
  const pkg = readPackageJson(where);
  if (!pkg) return;
  if (!existsSync(join(where, "node_modules"))) {
    add(
      `${label}: typecheck, test, build`,
      "SKIPPED",
      "dependencies not installed (run npm install)",
    );
    return;
  }
  const scripts = pkg.scripts ?? {};
  for (const name of ["typecheck", "test", "build"]) {
    if (name === "test" && argv.includes("--skip-tests")) {
      add(`${label}: test`, "SKIPPED", "--skip-tests");
      continue;
    }
    const script = scripts[name];
    if (!script || /no test specified/.test(script)) {
      const tsc = join(where, "node_modules", "typescript", "bin", "tsc");
      if (name === "typecheck" && existsSync(join(where, "tsconfig.json")) && existsSync(tsc)) {
        const r = run([process.execPath, tsc, "--noEmit", "-p", "tsconfig.json"], where);
        add(
          `${label}: tsc --noEmit`,
          r.status === 0 ? "PASS" : "FAIL",
          r.status === 0 ? "" : tail(r.stdout + r.stderr),
        );
      } else add(`${label}: ${name}`, "SKIPPED", `no "${name}" script in package.json`);
      continue;
    }
    const r = run(runScript(where, name), where);
    add(
      `${label}: ${name}`,
      r.status === 0 ? "PASS" : "FAIL",
      r.status === 0 ? "" : tail(r.stdout + r.stderr),
    );
  }
}
const workspace = Boolean(readPackageJson(dir)?.workspaces);
projectScripts(dir, workspace ? "workspace" : "backend");
if (!workspace && existsSync(join(dir, "web", "package.json")))
  projectScripts(join(dir, "web"), "web");

// 4. Live probes: read-only requests that must be refused without a session / CSRF header.
async function probe(
  name: string,
  path: string,
  init: RequestInit,
  expected: { status: number; code: string },
): Promise<void> {
  try {
    const res = await fetch(new URL(path, url), { ...init, redirect: "manual" });
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    const code = body?.error?.code;
    const ok = res.status === expected.status && code === expected.code;
    add(
      name,
      ok ? "PASS" : "FAIL",
      `${res.status} ${code ?? "(no error code)"}; expected ${expected.status} ${expected.code}`,
    );
  } catch (error) {
    add(
      name,
      "FAIL",
      `request failed: ${(error as Error).message}. Is the server running at ${url}?`,
    );
  }
}
if (url) {
  const origin = new URL(url).origin;
  await probe(
    `GET ${basePath}/me without a session`,
    `${basePath}/me`,
    {},
    { status: 401, code: "UNAUTHENTICATED" },
  );
  await probe(
    `POST ${basePath}/logout without the CSRF header`,
    `${basePath}/logout`,
    { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" },
    { status: 403, code: "CSRF_FAILED" },
  );
  for (const p of protectedPaths)
    await probe(`GET ${p} without a session`, p, {}, { status: 401, code: "UNAUTHENTICATED" });
  if (!protectedPaths.length)
    add(
      "protected application routes",
      "SKIPPED",
      "pass --protected <path> for each route that must require a session",
    );
} else {
  add("live HTTP probes", "SKIPPED", "no --url: the running server was not probed");
}

const failed = checks.filter((c) => c.status === "FAIL").length;
const skipped = checks.filter((c) => c.status === "SKIPPED").length;
const result = failed ? `FAIL (${failed} failed)` : "PASS";
if (argv.includes("--json")) {
  console.log(
    JSON.stringify({ result: failed ? "FAIL" : "PASS", failed, skipped, checks }, null, 2),
  );
} else {
  console.log(`SelfAuth validation → ${dir}\n`);
  for (const c of checks) {
    console.log(
      `${c.status.padEnd(7)} ${c.name}${c.detail && !c.detail.includes("\n") ? ` — ${c.detail}` : ""}`,
    );
    if (c.detail.includes("\n")) console.log(c.detail.replace(/^/gm, "        "));
  }
  console.log(
    `\nRESULT: ${result}${skipped ? ` — ${skipped} check(s) SKIPPED: not verified, report them` : ""}`,
  );
}
process.exit(failed ? 1 : 0);
