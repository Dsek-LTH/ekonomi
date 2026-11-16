// The events stock is taken out for. Picked from a list so "Onsdagspub" and "onsdagspub " cannot be two nights.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail } from "@/lib/api/guard";
import { gateStock } from "@/lib/api/stock-gate";
import { parseBody } from "@/lib/api/parse";
import { CreateStockEvent } from "@/lib/api/schemas/stock";
import { getStockEvents } from "@/lib/data/stock";
import { isoDay } from "@/lib/domain/date";
import { STOCKS } from "@/lib/stock/stocks";

export async function GET(req: Request) {
  const g = await gateStock(new URL(req.url).searchParams.get("stock"), "view");
  if (!g.ok) return g.res;
  return NextResponse.json(await getStockEvents(g.stock));
}

export async function POST(req: Request) {
  const parsed = await parseBody(req, CreateStockEvent);
  if (!parsed.ok) return parsed.res;

  const g = await gateStock(parsed.data.stock, "manage");
  if (!g.ok) return g.res;
  if (!STOCKS[g.stock].usesEvents) return fail(422, "stock.kindNotHere");

  const event = await prisma.stockEvent.create({
    data: {
      name: parsed.data.name,
      stockId: g.stock,
      costCenterId: parsed.data.costCenterId ?? null,
      date: new Date(parsed.data.date),
      actorId: g.actor.id,
    },
    select: { id: true, name: true, date: true },
  });
  return NextResponse.json(
    { id: event.id, name: event.name, date: isoDay(event.date), entries: 0 },
    { status: 201 },
  );
}
