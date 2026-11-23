import type { PrismaAuthStore } from "../../src/auth/stores/prisma.ts";

/** Security events in insertion order (PostgreSQL: the `seq` column). */
export async function readSecurityEvents(
  prisma: PrismaAuthStore,
): Promise<Record<string, unknown>[]> {
  const events = await prisma.db.authSecurityEvent.findMany({ orderBy: { seq: "asc" } });
  return events.map(({ seq: _seq, ...e }) => e);
}
