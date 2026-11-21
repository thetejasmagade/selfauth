import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface Harness {
  /** The port of the Python harness (127.0.0.1). */
  readonly port: number;
  close(): Promise<void>;
}

/**
 * The Python used to run the harness: SELFAUTH_FLASK_PYTHON, else the project's own virtual
 * environment (.venv), else python3.
 */
function python(): string {
  const configured = process.env["SELFAUTH_FLASK_PYTHON"];
  if (configured) return configured;
  const venv = join(appDir, ".venv", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
  return existsSync(venv) ? venv : "python3";
}

/** Starts the Python harness (test/harness/server.py) on a free port. */
export async function startHarness(): Promise<Harness> {
  const child: ChildProcess = spawn(python(), ["-u", "test/harness/server.py"], {
    cwd: appDir,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const port = await new Promise<number>((resolve, reject) => {
    const lines = createInterface({ input: child.stdout! });
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error(`the Python harness exited early (${code}); is the app's dependencies' installed? Run: pip install -e . in apps/playground-flask`)),
    );
    lines.once("line", (line) => {
      const match = /^listening 127\.0\.0\.1:(\d+)$/.exec(line);
      if (match) resolve(Number(match[1]));
      else reject(new Error(`unexpected harness output: ${line}`));
    });
  });
  child.removeAllListeners("exit");
  return {
    port,
    async close() {
      child.kill();
    },
  };
}

export interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
}

const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

/** One HTTP exchange with the harness. A string body is sent as is. */
export function send(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers, agent }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          text: Buffer.concat(chunks).toString("utf8"),
        }),
      );
      res.on("error", reject);
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
