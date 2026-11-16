// A move: stock carried from storage or a place to another, logged in one go. A refill is storage to a fridge, a
// committee bringing back what it did not use is its place to wherever it is put. See docs/stock.md, section 11.

import { NextResponse } from "next/server";
import { fail } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { gateStock } from "@/lib/api/stock-gate";
import { CreateStockMove } from "@/lib/api/schemas/stock";
import { canMoveBetween } from "@/lib/domain/permissions";
import { fiscalYearAround } from "@/lib/server/fiscal-year";
import { moveBatch } from "@/lib/server/stock-move";
import { bulkTransaction } from "@/lib/server/tx";

export async function POST(req: Request) {
  const parsed = await parseBody(req, CreateStockMove);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const g = await gateStock(body.stock, "move");
  if (!g.ok) return g.res;
  if (!canMoveBetween(g.actor, g.stock, body.from, body.to)) {
    return fail(403, "stock.moveNotYours");
  }

  const during = await fiscalYearAround(body.occurredAt);
  const result = await bulkTransaction((tx) =>
    moveBatch(tx, {
      stock: g.stock,
      from: body.from,
      to: body.to,
      batchId: body.batchId,
      occurredAt: new Date(body.occurredAt),
      lines: body.lines,
      actorId: g.actor.id,
      during,
      note: body.note,
    }),
  );
  if (!result.ok) return fail(422, result.error, { values: result.values });

  return NextResponse.json(
    { batchId: body.batchId, written: result.written },
    // A batch that was already there is not made again.
    { status: result.duplicate ? 200 : 201 },
  );
}
