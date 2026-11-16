// Mark a stock voucher as no longer sent, after it has been voided in Fortnox by hand. Only our record goes:
// what it carried is due again and will be sent in the next voucher.

import { fail, gate } from "@/lib/api/guard";
import { canUnexport } from "@/lib/domain/permissions";
import { unexportStockVoucher } from "@/lib/server/stock-posting";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gate(canUnexport, "auth.denied");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  if (!(await unexportStockVoucher(id))) return fail(404, "stockVoucher.notFound");
  return new Response(null, { status: 204 });
}
