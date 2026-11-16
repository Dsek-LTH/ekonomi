// One product type: its name and accounts, or removing it while nothing is of that type.

import { NextResponse } from "next/server";
import { gate, fail } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PatchStockGroup } from "@/lib/api/schemas/stock";
import { canAccessSettings } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";
import { isCollision } from "@/lib/server/stock-product-guard";
import { recordSettingsChanges, unknownAccount } from "@/lib/server/stock-settings-change";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;

  const parsed = await parseBody(req, PatchStockGroup);
  if (!parsed.ok) return parsed.res;
  const patch = parsed.data;

  const refused = await prisma
    .$transaction(async (tx) => {
      const before = await tx.stockGroup.findUnique({ where: { id } });
      if (!before) return fail(404, "stock.groupNotFound");

      const unknown = await unknownAccount(tx, [
        patch.stockAccount,
        patch.consumptionAccount,
        patch.lossAccount,
        patch.countDiffAccount,
      ]);
      if (unknown) return fail(422, "stock.accountUnknown", { values: { account: unknown } });

      await tx.stockGroup.update({ where: { id }, data: patch });
      await recordSettingsChanges(tx, {
        stockId: before.stockId,
        groupName: before.name,
        actorId: g.actor.id,
        before,
        patch,
      });
      return null;
    })
    .catch((err: unknown) => {
      if (isCollision(err)) return fail(409, "stock.groupNameTaken");
      throw err;
    });
  if (refused) return refused;
  return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;

  const refused = await prisma.$transaction(async (tx) => {
    const group = await tx.stockGroup.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!group) return fail(404, "stock.groupNotFound");
    // Its products' value sits on its accounts. They have to be moved to another type first.
    if (group._count.products > 0) {
      return fail(409, "stock.groupInUse", { values: { count: group._count.products } });
    }
    await tx.stockGroup.delete({ where: { id } });
    await recordSettingsChanges(tx, {
      stockId: group.stockId,
      groupName: group.name,
      actorId: g.actor.id,
      before: { name: group.name },
      patch: { name: null },
    });
    return null;
  });
  if (refused instanceof NextResponse) return refused;
  return new Response(null, { status: 204 });
}
