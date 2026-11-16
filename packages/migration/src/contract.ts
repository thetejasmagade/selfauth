/**
 * Migration adapter contract (development plan §4.3). SelfAuth orchestrates a
 * project's native migration tool (Prisma Migrate, Drizzle Kit, migrate-mongo,
 * EF Core, Alembic, Flyway, …); it never replaces it or applies migrations at
 * application startup (DATA-MODEL-003).
 */
import type { SqlFinding } from "./sql-analysis.js";

export interface MigrationFile {
  /** Native migration identifier, e.g. `20261116085533_selfauth_init`. */
  name: string;
  /** Path relative to the project root. */
  path: string;
  /** SQL (or the native representation) for review. */
  content: string;
}

export interface ProjectMigrationInfo {
  tool: string;
  schemaPath: string;
  migrationsPath: string;
  migrations: MigrationFile[];
}

export interface MigrationStatus {
  /** True when every migration file has been applied and none failed. */
  upToDate: boolean;
  applied: string[];
  pending: string[];
  failed: string[];
  /** Raw native tool output, for display. */
  output: string;
}

export interface MigrationPlan {
  pending: MigrationFile[];
  findings: (SqlFinding & { migration: string })[];
  /** Destructive or non-owned changes are present: applying needs explicit approval. */
  requiresApproval: boolean;
  /** Conflicts that approval cannot resolve (e.g. a table already exists). */
  blocked: boolean;
}

export interface MigrateResult {
  applied: boolean;
  /** Present when the migration was refused or failed. */
  reason?: string;
  plan: MigrationPlan;
  output: string;
}

export interface RollbackCapability {
  /** Whether the native tool supports automatic down migrations. */
  automatic: boolean;
  guidance: string;
}

export interface ValidationReport {
  ok: boolean;
  problems: string[];
}

export interface MigrationAdapter {
  readonly tool: string;
  inspect(): Promise<ProjectMigrationInfo>;
  status(): Promise<MigrationStatus>;
  plan(): Promise<MigrationPlan>;
  /** Creates a new native migration file without applying it. */
  generate(name: string): Promise<MigrationFile | null>;
  /** Applies pending migrations; refuses destructive plans unless approved. */
  migrate(options: { approveDestructive: boolean }): Promise<MigrateResult>;
  validate(): Promise<ValidationReport>;
  rollback(): Promise<RollbackCapability>;
}
