// Send a levfaktura back to the Inkorg ("Inte vår", or triage). Only while nothing on it is signed
// (isInvoiceReturnable). The invoice goes, its documents return with the reason.
import { prisma } from "@/lib/server/db";
import { isInvoiceReturnable } from "@/lib/domain/supplier-invoice";
import { gate } from "@/lib/api/guard";
import { applied, commit } from "@/lib/api/stale-write";
import { parseBody } from "@/lib/api/parse";
import { ReturnSupplierInvoice } from "@/lib/api/schemas/supplier-invoice";
import { loadInvoiceFor, refuseChange } from "@/lib/api/supplier-invoice-access";

// POST /api/supplier-invoices/:id/return: { reason }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, ReturnSupplierInvoice);
  if (!parsed.ok) return parsed.res;

  const access = await loadInvoiceFor(g.actor, id);
  if (!access.ok) return access.res;
  const { invoice, can } = access;
  if (!can.canReturnToInbox) return refuseChange(invoice, isInvoiceReturnable(invoice.status));

  const result = await commit(() =>
    prisma.$transaction(async (tx) => {
      await tx.supplierInvoiceDocument.updateMany({
        where: { invoiceId: invoice.id },
        data: {
          invoiceId: null,
          position: 0,
          returnedFrom: invoice.resultUnit?.name ?? null,
          returnNote: parsed.data.reason,
        },
      });
      // Still in the state it was judged returnable in: attested in another
      // tab a moment ago, it is not this request's to undo.
      applied(
        await tx.supplierInvoice.deleteMany({
          where: { id: invoice.id, status: invoice.status },
        }),
        "supplierInvoice.changedMeanwhile",
      );
    }),
  );
  if (result instanceof Response) return result;
  return new Response(null, { status: 204 });
}
