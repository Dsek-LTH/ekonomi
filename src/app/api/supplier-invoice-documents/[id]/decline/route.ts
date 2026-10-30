// The unit's "Inte vår" for a document in its Inkorg: back to triage, with
// the reason, and the unit it came back from, so triage can say why it is
// there again and give it to the right one.
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { applied, commit } from "@/lib/api/stale-write";
import { parseBody } from "@/lib/api/parse";
import { DeclineInvoiceDocument } from "@/lib/api/schemas/supplier-invoice";
import { loadInboxDocumentFor } from "@/lib/api/supplier-invoice-access";

// POST /api/supplier-invoice-documents/:id/decline: { reason }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, DeclineInvoiceDocument);
  if (!parsed.ok) return parsed.res;

  const access = await loadInboxDocumentFor(g.actor, id);
  if (!access.ok) return access.res;
  const { doc, can } = access;
  if (!can.canDecline) return fail(403, "supplierInvoice.denied");

  const result = await commit(async () =>
    applied(
      await prisma.supplierInvoiceDocument.updateMany({
        where: { id: doc.id, invoiceId: null, resultUnitId: doc.resultUnitId },
        data: {
          resultUnitId: null,
          assignedById: null,
          assignedAt: null,
          returnedFrom: doc.resultUnit?.name ?? null,
          returnNote: parsed.data.reason,
        },
      }),
      "supplierInvoice.changedMeanwhile",
    ),
  );
  if (result instanceof Response) return result;
  return new Response(null, { status: 204 });
}
