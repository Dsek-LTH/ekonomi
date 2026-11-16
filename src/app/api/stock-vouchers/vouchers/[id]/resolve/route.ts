// Settle a stock voucher whose request to Fortnox came back with no clear answer: look for it there. Found, it
// takes that number. Not found, it is dropped and its day is due again.

import { NextResponse } from "next/server";
import { fail, gate } from "@/lib/api/guard";
import { canBookkeep } from "@/lib/domain/permissions";
import { resolveStockVoucher } from "@/lib/server/stock-posting";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canBookkeep, "auth.bookkeeperExport");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;

  const outcome = await resolveStockVoucher(id);
  if (!outcome.ok) return fail(outcome.status, outcome.error, { values: outcome.values });
  if ("released" in outcome) return NextResponse.json({ released: true, date: outcome.date });
  return NextResponse.json({ released: false, label: outcome.label });
}
