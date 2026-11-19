import type { MigrationFile, MigrationPlan } from "./contract.js";
import type { Manifest } from "./manifest.js";
import { analyzeSql, createdObjects, type MigrationAuthor } from "./sql-analysis.js";

/**
 * Reviews pending SQL migrations, whatever tool applies them (Prisma Migrate, the Go runner).
 *
 * Ownership (DATA-MODEL-004) keeps SelfAuth's own migrations away from the application's tables,
 * so a SelfAuth migration (listed in the manifest) may only change what SelfAuth owns, plus what it
 * creates. The developer's migrations are the other way round: their own tables are theirs to
 * change, but SelfAuth's tables are not. Data-loss statements are reported for both.
 *
 * `existing` is what the database already holds, when known: creating an object that exists is a
 * conflict approval cannot resolve.
 */
export function reviewMigrations(
  pending: MigrationFile[],
  manifest: Manifest | null,
  existing: { tables: Set<string>; types: Set<string> } | null = null,
): MigrationPlan {
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
