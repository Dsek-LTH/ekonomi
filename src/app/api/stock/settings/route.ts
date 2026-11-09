// The stock feature's own settings (policy values). One row, like BookkeepingSettings.

import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateStockSettings } from "@/lib/api/schemas/stock";
import { canAccessSettings } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";

export async function PATCH(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, UpdateStockSettings);
  if (!parsed.ok) return parsed.res;

  // Upsert: nothing seeds this row. The default lives in the column.
  await prisma.stockSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...parsed.data },
    update: parsed.data,
  });

  return new Response(null, { status: 204 });
}
