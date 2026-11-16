// A board member logging what they took from the café stock. The goods leave the stock at cost like any removal
// (a WITHDRAWAL in the log, which the daily voucher carries), and the member owes the board price for them.

import { NextResponse } from "next/server";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateBoardWithdrawal } from "@/lib/api/schemas/board";
import { BOARD_STOCK } from "@/lib/data/board";
import { today } from "@/lib/domain/date";
import { canBookkeep, hasBoardTab } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";
import { issueBatch } from "@/lib/server/stock-issue";
import { bulkTransaction } from "@/lib/server/tx";

export async function POST(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;
  const treasurer = canBookkeep(g.actor.capabilities);
  if (!treasurer && !hasBoardTab(g.actor.capabilities)) return fail(403, "board.noTab");

  const parsed = await parseBody(req, CreateBoardWithdrawal);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  // Somebody else's tab is the treasurer's to write on.
  const memberId = body.memberId ?? g.actor.id;
  if (memberId !== g.actor.id) {
    if (!treasurer) return fail(403, "board.notYourTab");
    const member = await prisma.user.findUnique({ where: { id: memberId }, select: { id: true } });
    if (!member) return fail(404, "board.memberNotFound");
  }
  if (body.occurredAt > today()) return fail(422, "board.futureDate");

  // The price in force on the day, per product. A product without one is not the board's to take.
  const productIds = [...new Set(body.lines.map((l) => l.productId))];
  const prices = await prisma.boardPrice.findMany({
    where: { productId: { in: productIds }, validFrom: { lte: new Date(body.occurredAt) } },
    orderBy: { validFrom: "desc" },
    select: { productId: true, priceOre: true },
  });
  const priceOf = new Map<string, number>();
  for (const p of prices) if (!priceOf.has(p.productId)) priceOf.set(p.productId, p.priceOre);
  if (productIds.some((id) => !priceOf.has(id))) return fail(422, "board.noPrice");

  const result = await bulkTransaction(async (tx) => {
    const issued = await issueBatch(tx, {
      stock: BOARD_STOCK,
      kind: "WITHDRAWAL",
      batchId: body.batchId,
      occurredAt: new Date(body.occurredAt),
      lines: body.lines.map((l) => ({ productId: l.productId, units: l.qty })),
      actorId: g.actor.id,
    });
    if (!issued.ok || issued.duplicate) return issued;
    await tx.boardWithdrawal.createMany({
      data: issued.entries.map((e) => ({
        entryId: e.id,
        memberId,
        qty: e.units,
        unitPriceOre: priceOf.get(e.productId)!,
        loggedById: g.actor.id,
      })),
    });
    return issued;
  });
  if (!result.ok) return fail(422, result.error, { values: result.values });

  return NextResponse.json(
    { written: result.entries.length },
    { status: result.duplicate ? 200 : 201 },
  );
}
