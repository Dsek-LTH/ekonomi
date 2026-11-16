// Send what has changed on days that were already sent, as one correction voucher dated today.

import { z } from "zod";
import { parseBody } from "@/lib/api/parse";
import { exportResponse, gateStockExport } from "@/lib/api/stock-voucher-route";
import { exportStockVoucher } from "@/lib/server/stock-posting";

const Body = z.object({ fingerprint: z.string().min(1).max(32) });

export async function POST(req: Request, ctx: { params: Promise<{ stock: string }> }) {
  const { stock } = await ctx.params;
  const g = await gateStockExport(stock);
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, Body);
  if (!parsed.ok) return parsed.res;

  return exportResponse(
    await exportStockVoucher(
      g.stock,
      { kind: "CORRECTION" },
      parsed.data.fingerprint,
      g.actor.id,
      g.token,
    ),
  );
}
