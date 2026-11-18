/**
 * Databases other than PostgreSQL are derived from the PostgreSQL reference (ADR 0025): the tested
 * Prisma schema and store are transformed at generation time instead of being copied three times.
 * Each transform is exact: a marker or pattern that is not found throws, so a change to the
 * reference that the transform does not understand fails loudly (the same rule as `example.ts`).
 * The test suite runs the whole conformance suite against the transformed code.
 */
import type { Database } from "./templates.js";

/** Databases that are derived from the PostgreSQL reference. */
export type DerivedDialect = "sqlite";

export const isDerivedDialect = (database: Database): database is DerivedDialect =>
  database === "sqlite";

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

const BLOCK_TEXT: Record<DerivedDialect, Record<Block, string>> = { sqlite: SQLITE_BLOCKS };

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
  for (const block of BLOCKS) out = replaceBlock(out, block, BLOCK_TEXT[dialect][block]);
  return out
    .replace(
      "PostgreSQL AuthStore backed by Prisma",
      `${LABEL[dialect]} AuthStore backed by Prisma`,
    )
    .replace("Shared PostgreSQL rate-limit store", `Shared ${LABEL[dialect]} rate-limit store`);
}

const LABEL: Record<DerivedDialect, string> = { sqlite: "SQLite" };

function once(source: string, from: string | RegExp, to: string, what: string): string {
  const out = source.replace(from, to);
  if (out === source)
    throw new Error(`${what} changed: '${String(from)}' not found; update dialect.ts`);
  return out;
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
  // Native types (`@db.Uuid`, `@db.Timestamptz(3)`, ...) are PostgreSQL's.
  out = out.replace(/[ \t]+@db\.[A-Za-z]+(\([^)]*\))?/g, "");
  if (dialect === "sqlite") {
    // SQLite allows AUTOINCREMENT on the primary key only; `seq` was only an insertion-order aid.
    // SQLite cannot express a JSON default (Prisma writes `DEFAULT {}`, which is invalid SQL); the
    // store always supplies `metadata`.
    out = once(out, /(Json\s+)@default\("\{\}"\)/, "$1", "schema.prisma");
    out = once(
      out,
      / {2}\/\/\/ Insertion order; timestamps alone can tie\.\n {2}seq +BigInt +@unique @default\(autoincrement\(\)\)\n/,
      "",
      "schema.prisma",
    );
  }
  return out;
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
