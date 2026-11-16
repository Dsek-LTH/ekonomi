// Send a stock's voucher through a date to Fortnox: every day not yet sent, up to and including it, as one voucher
// dated that day. Only ever on a bookkeeper's press. The body carries the fingerprint of the figures they were
// shown, and a voucher whose figures have moved since is refused.

import { z } from "zod";
import { fail } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { exportResponse, gateStockExport } from "@/lib/api/stock-voucher-route";
import { isWholeDate } from "@/lib/data/list-query";
import { exportStockVoucher } from "@/lib/server/stock-posting";

const Body = z.object({ fingerprint: z.string().min(1).max(32) });

export async function POST(
  req: Request,
  ctx: { params: Promise<{ stock: string; date: string }> },
) {
  const { stock, date } = await ctx.params;
  const g = await gateStockExport(stock);
  if (!g.ok) return g.res;
  if (!isWholeDate(date)) return fail(404, "stockVoucher.notFound");

  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.res;

  return exportResponse(
    await exportStockVoucher(
      g.stock,
      { kind: "DAILY", date },
      parsed.data.fingerprint,
      g.actor.id,
      g.token,
    ),
  );
}
