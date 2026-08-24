// The occasions stock is taken out for.
//
// Created here rather than typed on a movement, so that "Onsdagspub" and
// "onsdagspub " cannot be two nights — a tag is picked from a list, and the
// list is what makes its arithmetic add up.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateStockTag } from "@/lib/api/schemas/stock";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import { getStockTags } from "@/lib/data/stock";

export async function GET() {
  const g = await gate(canViewStock, "stock.noAccess");
  if (!g.ok) return g.res;
  return NextResponse.json(await getStockTags());
}

export async function POST(req: Request) {
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateStockTag);
  if (!parsed.ok) return parsed.res;

  const tag = await prisma.stockTag.create({
    data: {
      name: parsed.data.name,
      date: new Date(parsed.data.date),
      actorId: g.actor.id,
    },
    select: { id: true, name: true, date: true },
  });
  return NextResponse.json(
    { id: tag.id, name: tag.name, date: tag.date.toISOString().slice(0, 10), entries: 0 },
    { status: 201 },
  );
}
