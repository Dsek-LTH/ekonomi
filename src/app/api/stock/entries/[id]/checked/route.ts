// Somebody went and looked at one delivery.
//
// The other half of the best-before warning, and the half that decides whether
// anybody keeps using it. A list of checks with no way to clear one fills up,
// stops being read, and is then worse than no list at all, because it looks
// like somebody is watching.
//
// Per delivery, because that is how the work is actually done. Each check is a
// task: go down, find the crate that came in on this date, read what is printed
// on it. A person works through them one at a time and wants to tick off the
// one they have just answered, not the whole product. That the cellar cannot
// tell two crates of the same lager apart is exactly why they are separate
// tasks rather than one: nobody can be sure the second crate says what the
// first one did.
//
// It does not silence anything for good. `checkedAt` pushes the next check out
// by the lead time, so a crate seen in December comes back in January, which is
// right: it is still a crate, and it is a month closer to the date. See
// lib/stock/expiry.ts.
//
// What it is not is a claim that the stock is fine. It is a record that
// somebody looked. Whatever they found that had gone off leaves the shelf as a
// SPOILAGE, through the ordinary route, because that is a movement of stock and
// this is not.
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
  // Only a delivery carries a date, so only a delivery can have been checked.
  // Anything else here is a client that has muddled up two rows, and storing
  // the day it happened on would leave a note nothing will ever read.
  if (entry.kind !== "PURCHASE" || !entry.bestBefore) return fail(422, "stock.noCheckOnRow");

  await prisma.stockEntry.update({
    where: { id },
    data: { checkedAt: new Date(today()) },
  });

  return NextResponse.json({ id });
}
