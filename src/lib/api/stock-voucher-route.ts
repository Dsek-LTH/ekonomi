// Shell shared by the routes that send a stock's vouchers to Fortnox: a bookkeeper, one of the fixed stocks,
// and the bookkeeper's own Fortnox token (exports are written under the person's name, lib/fortnox/export.ts).
import "server-only";

import { NextResponse } from "next/server";
import { fail, gate, type Actor } from "@/lib/api/guard";
import { canBookkeep } from "@/lib/domain/permissions";
import { userToken } from "@/lib/fortnox/export";
import type { ExportOutcome } from "@/lib/server/stock-posting";
import { isStockSlug, type StockSlug } from "@/lib/stock/stocks";

type Ready =
  { ok: true; actor: Actor; stock: StockSlug; token: string } | { ok: false; res: NextResponse };

export async function gateStockExport(stock: string): Promise<Ready> {
  const g = await gate(canBookkeep, "auth.bookkeeperExport");
  if (!g.ok) return g;
  if (!isStockSlug(stock)) return { ok: false, res: fail(404, "stock.unknownStock") };
  const auth = await userToken(g.actor.id);
  if (!auth.ok) return auth;
  return { ok: true, actor: g.actor, stock, token: auth.token };
}

/** An export's outcome as a response. */
export function exportResponse(outcome: ExportOutcome): NextResponse {
  if (!outcome.ok) return fail(outcome.status, outcome.error, { values: outcome.values });
  return NextResponse.json({
    id: outcome.voucherId,
    label: outcome.label,
    adopted: outcome.adopted,
  });
}
