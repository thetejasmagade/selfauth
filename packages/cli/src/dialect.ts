/**
 * Databases other than PostgreSQL are derived from the PostgreSQL reference (ADR 0025): the tested
 * Prisma schema and store are transformed at generation time instead of being copied three times.
 * Each transform is exact: a marker or pattern that is not found throws, so a change to the
 * reference that the transform does not understand fails loudly (the same rule as `example.ts`).
 * The test suite runs the whole conformance suite against the transformed code.
 */
import type { Database } from "./templates.js";

/** Databases that are derived from the PostgreSQL reference. */
export type DerivedDialect = "sqlite" | "mysql";

export const isDerivedDialect = (database: Database): database is DerivedDialect =>
  database === "sqlite" || database === "mysql";

/** The regions of `src/auth/stores/prisma.ts` that are specific to PostgreSQL. */
const BLOCKS = ["imports", "client", "links", "lockRow"] as const;
type Block = (typeof BLOCKS)[number];

const SQLITE_BLOCKS: Record<Block, string> = {
  imports: `import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
`,
  client: `export function createPrismaClient(options: {
  /** A SQLite file URL such as \`file:./app.db\` (DATABASE_URL). */
  connectionString: string;
  /** Not used with SQLite; accepted so every database shares one signature. */
  schema?: string;
  max?: number;
}): PrismaClient {
  // One connection, a 5 second wait for the write lock instead of failing at once.
  const adapter = new PrismaBetterSqlite3({ url: options.connectionString, timeout: 5000 });
  return new PrismaClient({ adapter });
}
`,
  // Prisma's SQLite connector has no \`skipDuplicates\`: an upsert that changes nothing does the same.
  links: `/** Adds role-permission links, skipping the ones that already exist. */
async function linkRolePermissions(
  tx: Tx,
  rows: { roleId: string; permissionId: string }[],
): Promise<void> {
  for (const row of rows) {
    await tx.authRolePermission.upsert({
      where: { roleId_permissionId: row },
      update: {},
      create: row,
    });
  }
}

/** Gives a user a role; already having it is not an error. */
async function linkUserRole(
  db: PrismaClient | Tx,
  row: { userId: string; roleId: string; assignedAt: Date; assignedBy: string | null },
): Promise<void> {
  await db.authUserRole.upsert({
    where: { userId_roleId: { userId: row.userId, roleId: row.roleId } },
    update: {},
    create: row,
  });
}
`,
  lockRow: `/**
 * Makes sure the row for \`key\` exists and locks it until the transaction ends, so concurrent
 * updates of one key serialize (a new row reads as \`windowEndsAt === 0\`). SQLite has no row
 * locks: the write that opens the transaction takes the database's write lock, and it is held
 * until commit.
 */
async function lockRateLimitRow(tx: Tx, key: string): Promise<RateLimitRecord> {
  const epoch = new Date(0);
  await tx.$executeRaw\`
    INSERT OR IGNORE INTO auth_rate_limits (key, count, window_ends_at, blocked_until, strikes, last_block_at)
    VALUES (\${key}, 0, \${epoch}, \${epoch}, 0, \${epoch})\`;
  const row = await tx.authRateLimit.findUniqueOrThrow({ where: { key } });
  return {
    count: row.count,
    windowEndsAt: row.windowEndsAt.getTime(),
    blockedUntil: row.blockedUntil.getTime(),
    strikes: row.strikes,
    lastBlockAt: row.lastBlockAt.getTime(),
  };
}
`,
};

const MYSQL_BLOCKS: Partial<Record<Block, string>> = {
  imports: `import { PrismaMariaDb } from "@prisma/adapter-mariadb";
`,
  client: `export function createPrismaClient(options: {
  /** A MySQL URL such as \`mysql://user:password@localhost:3306/app\` (DATABASE_URL). */
  connectionString: string;
  /** Not used with MySQL; accepted so every database shares one signature. */
  schema?: string;
  max?: number;
}): PrismaClient {
  const url = new URL(options.connectionString);
  if (options.max) url.searchParams.set("connectionLimit", String(options.max));
  const adapter = new PrismaMariaDb(url.toString());
  return new PrismaClient({ adapter });
}
`,
  // \`skipDuplicates\` (the \`links\` block) works on MySQL as it is, so that block is kept.
  lockRow: `/** A DATETIME read back by a raw query: a Date, or text in UTC. */
const instant = (value: Date | string): number =>
  value instanceof Date ? value.getTime() : Date.parse(\`\${value.replace(" ", "T")}Z\`);

/**
 * Makes sure the row for \`key\` exists and locks it until the transaction ends, so concurrent
 * updates of one key serialize (a new row reads as \`windowEndsAt === 0\`). The insert is an
 * upsert that changes nothing: for a row that exists it takes the write lock at once, where
 * \`INSERT IGNORE\` would take a shared lock and then deadlock when two transactions upgrade it.
 */
async function lockRateLimitRow(tx: Tx, key: string): Promise<RateLimitRecord> {
  const epoch = new Date(0);
  await tx.$executeRaw\`
    INSERT INTO auth_rate_limits (\\\`key\\\`, count, window_ends_at, blocked_until, strikes, last_block_at)
    VALUES (\${key}, 0, \${epoch}, \${epoch}, 0, \${epoch})
    ON DUPLICATE KEY UPDATE \\\`key\\\` = \\\`key\\\`\`;
  const rows = await tx.$queryRaw<
    {
      count: number;
      window_ends_at: Date | string;
      blocked_until: Date | string;
      strikes: number;
      last_block_at: Date | string;
    }[]
  >\`SELECT count, window_ends_at, blocked_until, strikes, last_block_at
    FROM auth_rate_limits WHERE \\\`key\\\` = \${key} FOR UPDATE\`;
  const row = rows[0]!;
  return {
    count: Number(row.count),
    windowEndsAt: instant(row.window_ends_at),
    blockedUntil: instant(row.blocked_until),
    strikes: Number(row.strikes),
    lastBlockAt: instant(row.last_block_at),
  };
}
`,
};

const BLOCK_TEXT: Record<DerivedDialect, Partial<Record<Block, string>>> = {
  sqlite: SQLITE_BLOCKS,
  mysql: MYSQL_BLOCKS,
};

function replaceBlock(source: string, name: Block, replacement: string): string {
  const open = `// <dialect:${name}>\n`;
  const close = `// </dialect:${name}>\n`;
  const start = source.indexOf(open);
  const end = source.indexOf(close);
  if (start < 0 || end < start) {
    throw new Error(
      `src/auth/stores/prisma.ts changed: block '${name}' not found; update dialect.ts`,
    );
  }
  return source.slice(0, start) + replacement + source.slice(end + close.length);
}

/** `src/auth/stores/prisma.ts` for `dialect`: PostgreSQL's blocks replaced by the dialect's. */
export function adaptStore(dialect: DerivedDialect, source: string): string {
  let out = source;
  for (const block of BLOCKS) {
    // A block the dialect does not replace is the PostgreSQL text, which works as it is.
    const text = BLOCK_TEXT[dialect][block];
    if (text !== undefined) out = replaceBlock(out, block, text);
  }
  out = withoutMarkers(out);
  return out
    .replace(
      "PostgreSQL AuthStore backed by Prisma",
      `${LABEL[dialect]} AuthStore backed by Prisma`,
    )
    .replace("Shared PostgreSQL rate-limit store", `Shared ${LABEL[dialect]} rate-limit store`);
}

const LABEL: Record<DerivedDialect, string> = { sqlite: "SQLite", mysql: "MySQL" };

function once(source: string, from: string | RegExp, to: string, what: string): string {
  const out = source.replace(from, to);
  if (out === source)
    throw new Error(`${what} changed: '${String(from)}' not found; update dialect.ts`);
  return out;
}

/**
 * Removes every native-type attribute (`@db.Uuid`, `@db.Timestamptz(3)`, ...) from one line, with
 * the spaces before it. Plain string scanning, no regular expression: linear on any input.
 */
function stripNativeTypes(line: string): string {
  let out = line;
  for (;;) {
    const at = out.indexOf("@db.");
    if (at < 0) return out;
    let end = at + "@db.".length;
    while (end < out.length && /[A-Za-z]/.test(out.charAt(end))) end++;
    if (out.charAt(end) === "(") {
      const close = out.indexOf(")", end);
      end = close < 0 ? out.length : close + 1;
    }
    let start = at;
    while (start > 0 && (out.charAt(start - 1) === " " || out.charAt(start - 1) === "\t")) start--;
    out = out.slice(0, start) + out.slice(end);
  }
}

/** MySQL's names for the native types PostgreSQL's schema uses; anything else must be common. */
function mysqlTypes(line: string): string {
  const out = line
    .replace("@db.Uuid", "@db.Char(36)")
    .replace("@db.Timestamptz(3)", "@db.DateTime(3)");
  const rest = out.indexOf("@db.");
  if (rest >= 0 && !/^@db\.(Char|VarChar|DateTime)\(/.test(out.slice(rest, rest + 16))) {
    throw new Error(
      `schema.prisma uses a native type MySQL does not map: ${out.trim()}; update dialect.ts`,
    );
  }
  return out;
}

/**
 * The migration SQL Prisma writes for a derived database, made safe. MySQL tables default to a
 * case- and accent-insensitive collation, so two different emails (or rate-limit keys) could
 * collide; SelfAuth compares exact bytes, as PostgreSQL does.
 */
export function adaptMigrationSql(dialect: DerivedDialect, sql: string): string {
  if (dialect !== "mysql") return sql;
  if (!sql.includes("COLLATE utf8mb4_unicode_ci")) {
    throw new Error("the MySQL migration has no utf8mb4_unicode_ci collation; update dialect.ts");
  }
  return sql.replaceAll("COLLATE utf8mb4_unicode_ci", "COLLATE utf8mb4_bin");
}

/** `prisma/schema.prisma` for `dialect`. */
export function adaptSchema(dialect: DerivedDialect, schema: string): string {
  let out = once(schema, 'provider = "postgresql"', `provider = "${dialect}"`, "schema.prisma");
  out = once(
    out,
    "SelfAuth data model for PostgreSQL",
    `SelfAuth data model for ${LABEL[dialect]}`,
    "schema.prisma",
  );
  // Native types are PostgreSQL's: SQLite has none; MySQL maps the two it does not share.
  let lines = out
    .split("\n")
    .map((l) => (dialect === "sqlite" ? stripNativeTypes(l) : mysqlTypes(l)));
  // Neither can express a JSON default (Prisma writes `DEFAULT {}`, invalid SQL); the store always
  // supplies `metadata`.
  const json = lines.findIndex((l) => l.includes("Json") && l.includes('@default("{}")'));
  if (json < 0) throw new Error("schema.prisma changed: no Json default; update dialect.ts");
  lines[json] = lines[json]!.replace('@default("{}")', "").trimEnd();
  if (dialect === "sqlite") {
    // SQLite allows AUTOINCREMENT on the primary key only; `seq` was only an insertion-order aid.
    const seq = lines.findIndex(
      (l) => l.trimStart().startsWith("seq ") && l.includes("autoincrement()"),
    );
    if (seq < 1 || !lines[seq - 1]!.includes("Insertion order")) {
      throw new Error("schema.prisma changed: no seq column; update dialect.ts");
    }
    lines = [...lines.slice(0, seq - 1), ...lines.slice(seq + 1)];
  }
  return lines.join("\n");
}

/** `src/db/store.ts` for `dialect` (messages and the SQLite pragma). */
export function adaptDbStore(dialect: DerivedDialect, source: string): string {
  let out = once(
    source,
    "PostgreSQL (Prisma) when DATABASE_URL",
    `${LABEL[dialect]} (Prisma) when DATABASE_URL`,
    "db/store.ts",
  );
  out = once(
    out,
    "(set DATABASE_URL to use PostgreSQL)",
    `(set DATABASE_URL to use ${LABEL[dialect]})`,
    "db/store.ts",
  );
  out = once(
    out,
    'console.log("Using PostgreSQL (Prisma) store.");',
    `console.log("Using ${LABEL[dialect]} (Prisma) store.");`,
    "db/store.ts",
  );
  if (dialect === "sqlite") {
    out = once(
      out,
      "  const store = new PrismaAuthStore(db);\n",
      `  // Write-ahead logging: readers do not block the writer (and the other way round).
  await db.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  try {
    await db.authRole.count();
  } catch {
    // A relative file: URL is read from the folder the server is started in; the migration
    // wrote it next to prisma.config.ts. Say so, instead of Prisma's "table does not exist".
    throw new Error(
      \`No SelfAuth tables in \${databaseUrl}. Run \\\`npm run db:migrate && npm run db:seed\\\` first. \` +
        "A relative file: URL is resolved from the folder you start the server in, so start it " +
        "from the same folder as prisma.config.ts.",
    );
  }
  const store = new PrismaAuthStore(db);
`,
      "db/store.ts",
    );
  }
  if (dialect === "mysql") {
    out = once(
      out,
      "  const store = new PrismaAuthStore(db);\n",
      `  try {
    await db.authRole.count();
  } catch {
    // Say what is missing, instead of Prisma's "table does not exist".
    throw new Error(
      "No SelfAuth tables in the database DATABASE_URL points to. Run \\\`npm run db:migrate && npm run db:seed\\\` first.",
    );
  }
  const store = new PrismaAuthStore(db);
`,
      "db/store.ts",
    );
  }
  return out;
}

/**
 * `src/auth/stores/prisma.ts` for PostgreSQL itself: the reference, without the marker comments
 * (they exist for the transforms above and mean nothing in a project).
 */
export function withoutMarkers(source: string): string {
  return source.replace(/^\/\/ <\/?dialect:[A-Za-z]+>\n/gm, "");
}

/** Applies the transform for `target` (a registry target path), or returns `content` unchanged. */
export function adaptForDialect(
  dialect: DerivedDialect | "postgresql",
  target: string,
  content: string,
): string {
  if (dialect === "postgresql") {
    return target === "src/auth/stores/prisma.ts" ? withoutMarkers(content) : content;
  }
  switch (target) {
    case "prisma/schema.prisma":
      return adaptSchema(dialect, content);
    case "src/auth/stores/prisma.ts":
      return adaptStore(dialect, content);
    case "src/db/store.ts":
      return adaptDbStore(dialect, content);
    default:
      return content;
  }
}
