// Somebody went and looked at one delivery (the best-before check, per delivery because each is
// its own task). `checkedAt` pushes the next check out by the lead time (lib/stock/expiry.ts). It
// records a look, not that the stock is fine: spoiled stock leaves as a SPOILAGE.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { canManageStock } from "@/lib/domain/permissions";
import { today } from "@/lib/domain/date";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const entry = await prisma.stockEntry.findUnique({
    where: { id },
    select: { id: true, kind: true, bestBefore: true },
  });
  if (!entry) return fail(404, "stock.entryNotFound");
  // Only a delivery carries a date, so only it can be checked.
  if (entry.kind !== "PURCHASE" || !entry.bestBefore) return fail(422, "stock.noCheckOnRow");

  await prisma.stockEntry.update({
    where: { id },
    data: { checkedAt: new Date(today()) },
  });

  return NextResponse.json({ id });
}
