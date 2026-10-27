// Fortnox projects as synced, for the project column on a voucher.
import "server-only";

import { prisma } from "@/lib/server/db";
import type { ProjectRecord } from "@/lib/domain/types";

// Projects a picker should offer: the active ones. `keep` forces specific
// numbers in even when closed, so a voucher already naming one still renders
// and re-saves. The same rule as getActiveAccounts.
export async function getActiveProjects(keep: readonly string[] = []): Promise<ProjectRecord[]> {
  const numbers = [...new Set(keep.filter(Boolean))];
  const rows = await prisma.project.findMany({
    where: numbers.length ? { OR: [{ active: true }, { number: { in: numbers } }] } : { active: true },
    orderBy: { number: "asc" },
  });
  return rows.map((p) => ({ number: p.number, name: p.name, active: p.active }));
}

/** How many projects are mirrored and when the sync last wrote one. */
export async function getProjectSyncStatus(): Promise<{ count: number; lastSyncAt: string | null }> {
  const agg = await prisma.project.aggregate({ _count: true, _max: { updatedAt: true } });
  return { count: agg._count, lastSyncAt: agg._max.updatedAt?.toISOString() ?? null };
}
