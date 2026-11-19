/**
 * Static review of migration SQL (migration safety rules, plan §4.5).
 * Deliberately conservative: anything that can lose data, rewrite a table,
 * or touch an object SelfAuth does not own is flagged for explicit approval.
 */
export type FindingKind =
  | "drop_table"
  | "drop_column"
  | "drop_type"
  | "drop_schema"
  | "truncate"
  | "delete"
  | "alter_column_type"
  | "set_not_null"
  | "rename"
  | "drop_constraint"
  | "drop_index"
  /** A SelfAuth migration changes an object the project owns outside SelfAuth (DATA-MODEL-004). */
  | "not_owned"
  /** The application's own migration changes a table SelfAuth owns (`auth_*`). */
  | "selfauth_table"
  /** A pending migration creates an object that already exists in the database. */
  | "already_exists";

export interface SqlFinding {
  kind: FindingKind;
  /** Object the statement affects (table or type), when known. */
  object: string | null;
  statement: string;
  /** 1-based line of the statement in the file. */
  line: number;
  severity: "destructive" | "risky";
}

// Double quotes are PostgreSQL and SQLite; backticks are MySQL.
const IDENT = String.raw`(?:"(?:[^"]|"")+"|\`(?:[^\`]|\`\`)+\`|[A-Za-z_][A-Za-z0-9_$]*)`;
const QUALIFIED = String.raw`(?:${IDENT}\.)?(${IDENT})`;

const unquote = (s: string) =>
  s.startsWith('"')
    ? s.slice(1, -1).replace(/""/g, '"')
    : s.startsWith("`")
      ? s.slice(1, -1).replace(/``/g, "`")
      : s.toLowerCase();

/** Splits SQL into statements, ignoring `--` / block comments and quoted semicolons. */
export function splitStatements(sql: string): { statement: string; line: number }[] {
  const out: { statement: string; line: number }[] = [];
  let current = "";
  let startLine = 1;
  let line = 1;
  let i = 0;
  let quote: "'" | '"' | "`" | null = null;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (!quote && ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (!quote && ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      const block = sql.slice(i, end < 0 ? sql.length : end + 2);
      line += block.split("\n").length - 1;
      i += block.length;
      continue;
    }
    if (ch === "\n") line++;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
    } else if (ch === ";") {
      if (current.trim()) out.push({ statement: current.trim(), line: startLine });
      current = "";
      i++;
      continue;
    }
    if (!current.trim() && !/\s/.test(ch)) startLine = line;
    current += ch;
    i++;
  }
  if (current.trim()) out.push({ statement: current.trim(), line: startLine });
  return out;
}

const RULES: { kind: FindingKind; severity: SqlFinding["severity"]; pattern: RegExp }[] = [
  {
    kind: "drop_table",
    severity: "destructive",
    pattern: new RegExp(String.raw`^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?${QUALIFIED}`, "i"),
  },
  {
    kind: "drop_type",
    severity: "destructive",
    pattern: new RegExp(String.raw`^DROP\s+TYPE\s+(?:IF\s+EXISTS\s+)?${QUALIFIED}`, "i"),
  },
  {
    kind: "drop_schema",
    severity: "destructive",
    pattern: new RegExp(
      String.raw`^DROP\s+(?:SCHEMA|DATABASE)\s+(?:IF\s+EXISTS\s+)?(${IDENT})`,
      "i",
    ),
  },
  {
    // MySQL: RENAME TABLE a TO b
    kind: "rename",
    severity: "destructive",
    pattern: new RegExp(String.raw`^RENAME\s+TABLE\s+${QUALIFIED}`, "i"),
  },
  {
    kind: "truncate",
    severity: "destructive",
    pattern: new RegExp(String.raw`^TRUNCATE\s+(?:TABLE\s+)?${QUALIFIED}`, "i"),
  },
  {
    kind: "delete",
    severity: "destructive",
    pattern: new RegExp(String.raw`^DELETE\s+FROM\s+${QUALIFIED}`, "i"),
  },
  {
    kind: "drop_index",
    severity: "risky",
    pattern: new RegExp(
      String.raw`^DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?${QUALIFIED}`,
      "i",
    ),
  },
];

const ALTER_TABLE = new RegExp(
  String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${QUALIFIED}\s+([\s\S]*)$`,
  "i",
);
const TOUCHES = new RegExp(
  String.raw`^(?:CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}\s+ON\s+(?:ONLY\s+)?${QUALIFIED}|INSERT\s+INTO\s+${QUALIFIED}|UPDATE\s+${QUALIFIED})`,
  "i",
);

/**
 * Who wrote the migration being reviewed. Ownership (DATA-MODEL-004) is about SelfAuth leaving the
 * application's objects alone, so the two authors are held to opposite rules:
 *
 * - `selfauth`: a migration shipped by SelfAuth. Any change to an object outside `owned` is
 *   reported as `not_owned`.
 * - `app`: a migration the developer wrote. The developer may change their own tables freely, so
 *   nothing is reported for those; a change to a table in `owned` (SelfAuth's) is reported as
 *   `selfauth_table`, unless the migration creates that table itself.
 *
 * Statements that lose data (drops, type changes, renames, truncates, deletes) are reported for
 * both authors, whoever owns the object.
 */
export type MigrationAuthor = "selfauth" | "app";

/**
 * Flags destructive or risky statements. `owned` is SelfAuth's tables and types (plus, for a
 * SelfAuth migration, the ones it creates); see {@link MigrationAuthor} for how it is used.
 */
export function analyzeSql(
  sql: string,
  owned?: { tables: string[]; types: string[] },
  author: MigrationAuthor = "selfauth",
): SqlFinding[] {
  const findings: SqlFinding[] = [];
  const ownedNames = owned
    ? new Set([...owned.tables, ...owned.types].map((n) => n.toLowerCase()))
    : null;
  const createdHere = new Set(
    author === "app"
      ? [...createdObjects(sql).tables, ...createdObjects(sql).types].map((n) => n.toLowerCase())
      : [],
  );
  const add = (
    kind: FindingKind,
    severity: SqlFinding["severity"],
    object: string | null,
    statement: string,
    line: number,
  ) => findings.push({ kind, severity, object, statement, line });
  const checkOwned = (object: string, statement: string, line: number) => {
    if (!ownedNames) return;
    const name = object.toLowerCase();
    if (author === "selfauth") {
      if (!ownedNames.has(name)) add("not_owned", "destructive", object, statement, line);
    } else if (ownedNames.has(name) && !createdHere.has(name)) {
      add("selfauth_table", "destructive", object, statement, line);
    }
  };

  for (const { statement, line } of splitStatements(sql)) {
    for (const rule of RULES) {
      const m = rule.pattern.exec(statement);
      if (m) {
        const object = unquote(m[1]!);
        add(rule.kind, rule.severity, object, statement, line);
        if (rule.kind !== "drop_index") checkOwned(object, statement, line);
      }
    }
    const alter = ALTER_TABLE.exec(statement);
    if (alter) {
      const table = unquote(alter[1]!);
      const actions = alter[2]!;
      checkOwned(table, statement, line);
      if (
        /\bDROP\s+(?:COLUMN\s+)?(?!CONSTRAINT\b|DEFAULT\b|NOT\s+NULL\b|FOREIGN\b|PRIMARY\b|INDEX\b|KEY\b|CHECK\b)/i.test(
          actions,
        )
      )
        add("drop_column", "destructive", table, statement, line);
      if (/\bALTER\s+(?:COLUMN\s+)?\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i.test(actions))
        add("alter_column_type", "destructive", table, statement, line);
      // MySQL changes a column's type or name with MODIFY and CHANGE.
      if (/\b(?:MODIFY|CHANGE)\s+(?:COLUMN\s+)?/i.test(actions))
        add("alter_column_type", "destructive", table, statement, line);
      if (/\bSET\s+NOT\s+NULL\b/i.test(actions))
        add("set_not_null", "risky", table, statement, line);
      if (/\bRENAME\b/i.test(actions)) add("rename", "destructive", table, statement, line);
      if (/\bDROP\s+(?:CONSTRAINT|FOREIGN\s+KEY|PRIMARY\s+KEY|CHECK)\b/i.test(actions))
        add("drop_constraint", "risky", table, statement, line);
    } else {
      const touched = TOUCHES.exec(statement);
      const object = touched?.slice(1).find((g) => g !== undefined);
      if (object) checkOwned(unquote(object), statement, line);
    }
    if (/^ALTER\s+TYPE\s/i.test(statement) && /\bRENAME\b/i.test(statement))
      add("rename", "destructive", null, statement, line);
  }
  return findings;
}

/** Objects a migration creates: used to build and verify the ownership manifest. */
export function createdObjects(sql: string): { tables: string[]; types: string[] } {
  const tables: string[] = [];
  const types: string[] = [];
  for (const { statement } of splitStatements(sql)) {
    const t = new RegExp(
      String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${QUALIFIED}`,
      "i",
    ).exec(statement);
    if (t) tables.push(unquote(t[1]!));
    const ty = new RegExp(String.raw`^CREATE\s+TYPE\s+${QUALIFIED}`, "i").exec(statement);
    if (ty) types.push(unquote(ty[1]!));
  }
  return { tables, types };
}
