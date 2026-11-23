import type { PrismaAuthStore } from "../../src/auth/stores/prisma.ts";

/** Security events in insertion order. SQLite has no `seq` column here: its `rowid` is the order. */
export async function readSecurityEvents(
  prisma: PrismaAuthStore,
): Promise<Record<string, unknown>[]> {
  const order = (
    await prisma.db.$queryRawUnsafe<{ id: string }[]>(
      "SELECT id FROM auth_security_events ORDER BY rowid",
    )
  ).map((r) => r.id);
  const events = await prisma.db.authSecurityEvent.findMany();
  return events.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
