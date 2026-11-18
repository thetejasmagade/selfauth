import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface Harness {
  /** host:port of the Go harness (127.0.0.1). */
  readonly port: number;
  close(): Promise<void>;
}

/** Builds the Go harness (test/harness) and starts it on a free port. */
export async function startHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "selfauth-gin-"));
  const binary = join(dir, "harness");
  const build = spawnSync("go", ["build", "-o", binary, "./test/harness"], {
    cwd: appDir,
    encoding: "utf8",
  });
  if (build.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`go build failed:\n${build.stdout}${build.stderr}`);
  }
  const child: ChildProcess = spawn(binary, [], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise<number>((resolve, reject) => {
    const lines = createInterface({ input: child.stdout! });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`harness exited early (${code})`)));
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
      rmSync(dir, { recursive: true, force: true });
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
