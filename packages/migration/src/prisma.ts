import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type {
  MigrateResult,
  MigrationAdapter,
  MigrationFile,
  MigrationPlan,
  MigrationStatus,
  ProjectMigrationInfo,
  RollbackCapability,
  ValidationReport,
} from "./contract.js";
import { readManifest, MANIFEST_FILE, type Manifest } from "./manifest.js";
import { analyzeSql, createdObjects, type MigrationAuthor } from "./sql-analysis.js";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the native tool; injectable for tests. */
export type CommandRunner = (
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

/**
 * The project's local Prisma CLI entry script (`node_modules/prisma/build/index.js`), in `cwd`
 * or a parent folder. In an npm workspace (a full-stack project's server/ and client/) the
 * package manager hoists dependencies to the workspace root, so it is not in the package's own
 * folder. The entry script is run with Node itself: the `.bin/prisma` shim is a shell script
 * that Windows cannot execute directly.
 */
export function findLocalPrisma(cwd: string): string | null {
  let dir = cwd;
  for (let i = 0; i < 5; i++) {
    const packageDir = join(dir, "node_modules", "prisma");
    const manifest = join(packageDir, "package.json");
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
          bin?: string | Record<string, string>;
        };
        const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["prisma"];
        const entry = bin ? join(packageDir, bin) : null;
        if (entry && existsSync(entry)) return entry;
      } catch {
        // an unreadable package.json: keep looking in the parent
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Default runner: the project's local Prisma CLI, started with the current Node.js. */
export const localPrisma: CommandRunner = (args, { cwd, env }) =>
  new Promise((resolve) => {
    const entry = findLocalPrisma(cwd);
    if (!entry) {
      resolve({
        code: 127,
        stdout: "",
        stderr: `Prisma is not installed: no node_modules/prisma in ${cwd} or its parent folders. Run \`npm install\` first.`,
      });
      return;
    }
    execFile(
      process.execPath,
      [entry, ...args],
      { cwd, env, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        // A failure to start the process has no output: show why, instead of an empty message.
        resolve({ code, stdout, stderr: stderr || (error && !stdout ? error.message : "") });
      },
    );
  });

export interface PrismaAdapterOptions {
  /** Project root containing prisma.config.ts or prisma/schema.prisma. */
  cwd: string;
  schemaPath?: string;
  migrationsPath?: string;
  /** Environment for the native tool (DATABASE_URL lives here, never in code). */
  env?: NodeJS.ProcessEnv;
  run?: CommandRunner;
  /** Passed to Prisma as `--config` (defaults to the project's prisma.config.ts). */
  configPath?: string;
}

const MIGRATION_NAME = /\b\d{14}_[A-Za-z0-9_]+\b/g;

/** Orchestrates Prisma Migrate. Prisma owns history, locking and checksums. */
export class PrismaMigrationAdapter implements MigrationAdapter {
  readonly tool = "prisma";
  private readonly cwd: string;
  private readonly schemaPath: string;
  private readonly migrationsPath: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly run: CommandRunner;
  private readonly configArgs: string[];

  constructor(options: PrismaAdapterOptions) {
    this.configArgs = options.configPath ? ["--config", options.configPath] : [];
    this.cwd = options.cwd;
    this.schemaPath = options.schemaPath ?? join(options.cwd, "prisma", "schema.prisma");
    this.migrationsPath = options.migrationsPath ?? join(options.cwd, "prisma", "migrations");
    this.env = options.env ?? process.env;
    this.run = options.run ?? localPrisma;
  }

  private prisma(args: string[]): Promise<CommandResult> {
    return this.run([...args, ...this.configArgs], { cwd: this.cwd, env: this.env });
  }

  /**
   * Tables and types currently in the database, read from Prisma's own
   * "diff to empty" script (no direct database access needed). Null when the
   * database cannot be read.
   */
  private async existingObjects(): Promise<{ tables: Set<string>; types: Set<string> } | null> {
    const result = await this.prisma([
      "migrate",
      "diff",
      "--from-config-datasource",
      "--to-empty",
      "--script",
    ]);
    if (result.code !== 0) return null;
    const findings = analyzeSql(result.stdout);
    return {
      tables: new Set(findings.filter((f) => f.kind === "drop_table").map((f) => f.object!)),
      types: new Set(findings.filter((f) => f.kind === "drop_type").map((f) => f.object!)),
    };
  }

  private async migrationFiles(): Promise<MigrationFile[]> {
    if (!existsSync(this.migrationsPath)) return [];
    const dirs = (await readdir(this.migrationsPath, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    return Promise.all(
      dirs.map(async (name) => {
        const path = join(this.migrationsPath, name, "migration.sql");
        return { name, path: relative(this.cwd, path), content: await readFile(path, "utf8") };
      }),
    );
  }

  private async manifest(): Promise<Manifest | null> {
    const path = join(this.cwd, MANIFEST_FILE);
    return existsSync(path) ? readManifest(path) : null;
  }

  async inspect(): Promise<ProjectMigrationInfo> {
    if (!existsSync(this.schemaPath))
      throw new Error(`Prisma schema not found at ${relative(this.cwd, this.schemaPath)}`);
    return {
      tool: this.tool,
      schemaPath: relative(this.cwd, this.schemaPath),
      migrationsPath: relative(this.cwd, this.migrationsPath),
      migrations: await this.migrationFiles(),
    };
  }

  async status(): Promise<MigrationStatus> {
    const result = await this.prisma(["migrate", "status"]);
    const output = `${result.stdout}\n${result.stderr}`;
    const files = (await this.migrationFiles()).map((m) => m.name);
    const section = (heading: RegExp) => {
      const m = heading.exec(output);
      if (!m) return [];
      const rest = output.slice(m.index + m[0].length);
      const block = rest.split(/\n\s*\n/)[0] ?? "";
      return [...block.matchAll(MIGRATION_NAME)].map((x) => x[0]);
    };
    // A SQLite database is a file that the first `migrate deploy` creates: before that, Prisma
    // answers "database does not exist", which here only means nothing has been applied yet.
    if (result.code !== 0 && /SQLite database/i.test(output) && /P1003/.test(output)) {
      return { upToDate: false, applied: [], pending: files, failed: [], output };
    }
    const pending = section(/have not yet been applied:/i);
    const failed = section(/failed/i).filter((n) => files.includes(n));
    const upToDate = result.code === 0 && /up to date/i.test(output);
    if (
      result.code !== 0 &&
      pending.length === 0 &&
      failed.length === 0 &&
      !/not yet been applied/i.test(output)
    ) {
      throw new Error(`prisma migrate status failed:\n${output.trim()}`);
    }
    return {
      upToDate,
      applied: files.filter((n) => !pending.includes(n) && !failed.includes(n)),
      pending,
      failed,
      output,
    };
  }

  async plan(): Promise<MigrationPlan> {
    const [status, files, manifest, existing] = await Promise.all([
      this.status(),
      this.migrationFiles(),
      this.manifest(),
      this.existingObjects(),
    ]);
    const pending = files.filter((f) => status.pending.includes(f.name));
    // Ownership (DATA-MODEL-004) keeps SelfAuth's own migrations away from the application's
    // tables, so a SelfAuth migration may only change what SelfAuth owns (plus what it creates).
    // The developer's migrations are the other way round: their own tables are theirs to change,
    // but SelfAuth's tables are not. Data-loss statements are reported for both.
    const findings = pending.flatMap((f) => {
      const created = createdObjects(f.content);
      const author: MigrationAuthor = manifest?.ownedResources.migrations.includes(f.name)
        ? "selfauth"
        : "app";
      const owned = manifest
        ? {
            tables: [
              ...manifest.ownedResources.tables,
              ...(author === "selfauth" ? created.tables : []),
            ],
            types: [
              ...manifest.ownedResources.types,
              ...(author === "selfauth" ? created.types : []),
            ],
          }
        : undefined;
      const conflicts = [
        ...created.tables.filter((t) => existing?.tables.has(t)),
        ...created.types.filter((t) => existing?.types.has(t)),
      ].map((object) => ({
        kind: "already_exists" as const,
        severity: "destructive" as const,
        object,
        statement: `CREATE ${created.tables.includes(object) ? "TABLE" : "TYPE"} "${object}"`,
        line: 0,
      }));
      return [...conflicts, ...analyzeSql(f.content, owned, author)].map((finding) => ({
        ...finding,
        migration: f.name,
      }));
    });
    return {
      pending,
      findings,
      requiresApproval: findings.length > 0,
      blocked: findings.some((f) => f.kind === "already_exists"),
    };
  }

  async generate(name: string): Promise<MigrationFile | null> {
    if (!/^[a-z0-9_]+$/.test(name)) throw new Error("migration name must be lower_snake_case");
    const before = new Set((await this.migrationFiles()).map((m) => m.name));
    const result = await this.prisma(["migrate", "dev", "--create-only", "--name", name]);
    if (result.code !== 0)
      throw new Error(
        `prisma migrate dev --create-only failed:\n${result.stderr || result.stdout}`,
      );
    return (await this.migrationFiles()).find((m) => !before.has(m.name)) ?? null;
  }

  async migrate(options: { approveDestructive: boolean }): Promise<MigrateResult> {
    const plan = await this.plan();
    if (plan.pending.length === 0)
      return { applied: false, reason: "no pending migrations", plan, output: "" };
    if (plan.blocked) {
      const names = plan.findings.filter((f) => f.kind === "already_exists").map((f) => f.object);
      return {
        applied: false,
        reason: `objects already exist in the database: ${names.join(", ")}. Rename SelfAuth's tables in schema.prisma or resolve the conflict manually; nothing was changed`,
        plan,
        output: "",
      };
    }
    if (plan.requiresApproval && !options.approveDestructive) {
      return {
        applied: false,
        reason:
          "plan contains destructive or non-owned changes; review the findings and approve explicitly",
        plan,
        output: "",
      };
    }
    // `migrate deploy` applies committed migrations only: no schema drift resets, no prompts.
    const result = await this.prisma(["migrate", "deploy"]);
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.code === 0) return { applied: true, plan, output };
    if (/\bP3005\b/.test(output)) {
      return {
        applied: false,
        reason:
          "the database already has tables but no Prisma migration history (P3005). Baseline it first: " +
          "create a migration for the existing schema with `prisma migrate diff --from-empty --to-config-datasource --script`, " +
          "mark it applied with `prisma migrate resolve --applied <name>`, then migrate again. See https://pris.ly/d/migrate-baseline",
        plan,
        output,
      };
    }
    if (/database is locked|SQLITE_BUSY/i.test(output)) {
      return {
        applied: false,
        reason:
          "the SQLite database is locked: another program has it open, usually the running server. " +
          "Stop it (Ctrl+C in its terminal), run the migration again, then start it again",
        plan,
        output,
      };
    }
    return { applied: false, reason: "prisma migrate deploy failed", plan, output };
  }

  async validate(): Promise<ValidationReport> {
    const problems: string[] = [];
    const result = await this.prisma(["validate"]);
    if (result.code !== 0)
      problems.push(`schema invalid: ${(result.stderr || result.stdout).trim()}`);
    const manifest = await this.manifest();
    if (!manifest) {
      problems.push(`${MANIFEST_FILE} not found`);
    } else {
      const files = await this.migrationFiles();
      const created = files.map((f) => createdObjects(f.content));
      const tables = new Set(created.flatMap((c) => c.tables));
      const types = new Set(created.flatMap((c) => c.types));
      for (const t of manifest.ownedResources.tables)
        if (!tables.has(t)) problems.push(`owned table '${t}' is not created by any migration`);
      for (const t of manifest.ownedResources.types)
        if (!types.has(t)) problems.push(`owned type '${t}' is not created by any migration`);
      const names = new Set(files.map((f) => f.name));
      for (const m of manifest.ownedResources.migrations)
        if (!names.has(m)) problems.push(`owned migration '${m}' is missing`);
    }
    return { ok: problems.length === 0, problems };
  }

  async rollback(): Promise<RollbackCapability> {
    return {
      automatic: false,
      guidance:
        "Prisma Migrate has no automatic down migrations. Restore from a backup taken before migrating, or write a new forward migration that reverts the change. To recover a failed migration, fix the database and run `prisma migrate resolve --rolled-back <name>`.",
    };
  }
}
