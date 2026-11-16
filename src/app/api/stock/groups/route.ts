// A stock's product types, which its accounts hang on. See StockGroup in stock.prisma.

import { NextResponse } from "next/server";
import { gate, fail } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { gateStock } from "@/lib/api/stock-gate";
import { CreateStockGroup } from "@/lib/api/schemas/stock";
import { getStockGroups } from "@/lib/data/stock";
import { canAccessSettings } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";
import { isCollision } from "@/lib/server/stock-product-guard";
import { recordSettingsChanges, unknownAccount } from "@/lib/server/stock-settings-change";

export async function GET(req: Request) {
  const g = await gateStock(new URL(req.url).searchParams.get("stock"), "enter");
  if (!g.ok) return g.res;
  return NextResponse.json(await getStockGroups(g.stock));
}

export async function POST(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateStockGroup);
  if (!parsed.ok) return parsed.res;
  const { stock, ...fields } = parsed.data;

  const made = await prisma
    .$transaction(async (tx) => {
      const unknown = await unknownAccount(tx, [
        fields.stockAccount,
        fields.consumptionAccount,
        fields.lossAccount,
        fields.countDiffAccount,
      ]);
      if (unknown) return fail(422, "stock.accountUnknown", { values: { account: unknown } });

      const last = await tx.stockGroup.aggregate({
        where: { stockId: stock },
        _max: { sortOrder: true },
      });
      const group = await tx.stockGroup.create({
        data: { ...fields, stockId: stock, sortOrder: (last._max.sortOrder ?? -1) + 1 },
        select: { id: true },
      });
      await recordSettingsChanges(tx, {
        stockId: stock,
        groupName: fields.name,
        actorId: g.actor.id,
        before: {},
        patch: fields,
      });
      return group;
    })
    .catch((err: unknown) => {
      if (isCollision(err)) return fail(409, "stock.groupNameTaken");
      throw err;
    });
  if (made instanceof NextResponse) return made;
  return NextResponse.json({ id: made.id }, { status: 201 });
}
