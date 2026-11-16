// Bring the stock accounts in Fortnox to the log's value on a chosen day: the opening when posting starts, and
// the year-end reconciliation.

import { z } from "zod";
import { parseBody } from "@/lib/api/parse";
import { IsoDate } from "@/lib/api/schemas/common";
import { exportResponse, gateStockExport } from "@/lib/api/stock-voucher-route";
import { exportReconciliation } from "@/lib/server/stock-posting";

const Body = z.object({ date: IsoDate });

export async function POST(req: Request, ctx: { params: Promise<{ stock: string }> }) {
  const { stock } = await ctx.params;
  const g = await gateStockExport(stock);
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.res;

  return exportResponse(await exportReconciliation(g.stock, parsed.data.date, g.actor.id, g.token));
}
