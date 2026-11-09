import "server-only";

import { prisma } from "@/lib/server/db";
import type { ProjectRecord } from "@/lib/domain/types";

// `keep` forces numbers in even when closed, so a voucher naming one still renders and re-saves.
export async function getActiveProjects(keep: readonly string[] = []): Promise<ProjectRecord[]> {
  const numbers = [...new Set(keep.filter(Boolean))];
  const rows = await prisma.project.findMany({
    where: numbers.length
      ? { OR: [{ active: true }, { number: { in: numbers } }] }
      : { active: true },
    orderBy: { number: "asc" },
  });
  return rows.map((p) => ({ number: p.number, name: p.name, active: p.active }));
}

export async function getProjectSyncStatus(): Promise<{
  count: number;
  lastSyncAt: string | null;
}> {
  const agg = await prisma.project.aggregate({ _count: true, _max: { updatedAt: true } });
  return { count: agg._count, lastSyncAt: agg._max.updatedAt?.toISOString() ?? null };
}
