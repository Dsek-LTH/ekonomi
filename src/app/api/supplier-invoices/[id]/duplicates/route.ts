// GET /api/supplier-invoices/:id/duplicates?supplier=&number=
// Whether the supplier's invoice number, as typed at kontering, is already on another invoice here or in Fortnox.
// Asked of what is typed, not what is saved, so the kontering says so before Spara (lib/server/supplier-invoice-duplicates).
import { NextResponse } from "next/server";
import { fail, gate } from "@/lib/api/guard";
import { loadInvoiceFor, refuseChange } from "@/lib/api/supplier-invoice-access";
import { isWithTreasury } from "@/lib/domain/supplier-invoice";
import { findInvoiceDuplicates } from "@/lib/server/supplier-invoice-duplicates";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const access = await loadInvoiceFor(g.actor, id);
  if (!access.ok) return access.res;
  const { invoice, can } = access;
  if (!can.canBook) return refuseChange(invoice, isWithTreasury(invoice.status));

  const params = new URL(req.url).searchParams;
  const supplier = params.get("supplier")?.trim() ?? "";
  const number = params.get("number")?.trim() ?? "";
  if (!supplier || !number) return fail(422, "supplierInvoice.noInvoiceNumber");

  return NextResponse.json(await findInvoiceDuplicates(invoice.id, supplier, number));
}
