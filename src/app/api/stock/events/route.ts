// The events stock is taken out for.
//
// Created here rather than typed on a movement, so that "Onsdagspub" and
// "onsdagspub " cannot be two nights. An event is picked from a list, and the
// list is what makes its arithmetic add up.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateStockEvent } from "@/lib/api/schemas/stock";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import { getStockEvents } from "@/lib/data/stock";

export async function GET() {
  const g = await gate(canViewStock, "stock.noAccess");
  if (!g.ok) return g.res;
  return NextResponse.json(await getStockEvents());
}

export async function POST(req: Request) {
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateStockEvent);
  if (!parsed.ok) return parsed.res;

  const event = await prisma.stockEvent.create({
    data: {
      name: parsed.data.name,
      date: new Date(parsed.data.date),
      actorId: g.actor.id,
    },
    select: { id: true, name: true, date: true },
  });
  return NextResponse.json(
    { id: event.id, name: event.name, date: event.date.toISOString().slice(0, 10), entries: 0 },
    { status: 201 },
  );
}
