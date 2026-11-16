// How one stock is booked: its accounts, cost centres, voucher series, the day posting starts, and its notice
// period for best-before checks. Every change is written to StockSettingsChange.

import { gate, fail } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateStock } from "@/lib/api/schemas/stock";
import { canAccessSettings } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";
import { recordSettingsChanges, unknownAccount } from "@/lib/server/stock-settings-change";
import { isStockSlug } from "@/lib/stock/stocks";

const COST_CENTERS = [
  "consumptionCostCenterId",
  "purchaseCostCenterId",
  "lossCostCenterId",
  "countDiffCostCenterId",
  "boardCostCenterId",
  "boardSalesCostCenterId",
] as const;

export async function PATCH(req: Request, ctx: { params: Promise<{ stock: string }> }) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;
  const { stock } = await ctx.params;
  if (!isStockSlug(stock)) return fail(404, "stock.unknownStock");

  const parsed = await parseBody(req, UpdateStock);
  if (!parsed.ok) return parsed.res;
  const { postingStartsOn, ...rest } = parsed.data;
  const patch = {
    ...rest,
    postingStartsOn:
      postingStartsOn === undefined ? undefined : postingStartsOn && new Date(postingStartsOn),
  };

  const refused = await prisma.$transaction(async (tx) => {
    const before = await tx.stock.findUniqueOrThrow({ where: { id: stock } });

    const unknown = await unknownAccount(tx, [
      patch.purchaseOffsetAccount,
      patch.boardCostAccount,
      patch.boardSalesAccount,
    ]);
    if (unknown) return fail(422, "stock.accountUnknown", { values: { account: unknown } });

    const centres = COST_CENTERS.map((k) => patch[k]).filter((id): id is string => Boolean(id));
    if (centres.length > 0) {
      const found = await tx.costCenter.count({ where: { id: { in: [...new Set(centres)] } } });
      if (found !== new Set(centres).size) return fail(422, "stock.costCenterUnknown");
    }

    await tx.stock.update({ where: { id: stock }, data: patch });
    await recordSettingsChanges(tx, { stockId: stock, actorId: g.actor.id, before, patch });
    return null;
  });
  if (refused) return refused;

  return new Response(null, { status: 204 });
}
