// Giving a document in the Inkorg to a result unit, or to another one: it is
// in that unit's Inkorg then, for the unit to fördela, which is what makes it
// an invoice. Triage's. The unit's resultatansvarig is told.
//
// Nothing else is kept: who gave it and when, for the invoice's history once
// there is one, and the due date when triage read one off it, so the unit can
// see what is urgent. A reason it came back from another unit is cleared,
// since it is answered by giving it somewhere else. Sent again to the unit it
// is already with, only the due date changes, and nobody is mailed twice.
import { prisma } from "@/lib/server/db";
import { deliverSoon, notify } from "@/lib/server/notify";
import { documentNotice } from "@/lib/email/content";
import { cleanSubject } from "@/lib/domain/inbound-mail";
import { isoToDate } from "@/lib/domain/date";
import { fail, gate } from "@/lib/api/guard";
import { applied, commit } from "@/lib/api/stale-write";
import { parseBody } from "@/lib/api/parse";
import { AssignInvoiceDocument } from "@/lib/api/schemas/supplier-invoice";
import { loadInboxDocumentFor, unitOwnersOf } from "@/lib/api/supplier-invoice-access";

// POST /api/supplier-invoice-documents/:id/assign: { resultUnitId, dueDate? }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, AssignInvoiceDocument);
  if (!parsed.ok) return parsed.res;

  const access = await loadInboxDocumentFor(g.actor, id);
  if (!access.ok) return access.res;
  const { doc, can } = access;
  if (!can.canAssign) return fail(403, "supplierInvoice.denied");

  const unit = await prisma.resultUnit.findUnique({
    where: { id: parsed.data.resultUnitId },
    select: { id: true, name: true },
  });
  if (!unit) return fail(422, "supplierInvoice.unknownResultUnit");

  const { dueDate } = parsed.data;
  const due = dueDate === undefined ? {} : { dueDate: dueDate ? isoToDate(dueDate) : null };
  const where = { id: doc.id, invoiceId: null, resultUnitId: doc.resultUnitId };

  if (unit.id === doc.resultUnitId) {
    const result = await commit(async () =>
      applied(await prisma.supplierInvoiceDocument.updateMany({ where, data: due }), "supplierInvoice.changedMeanwhile"),
    );
    if (result instanceof Response) return result;
    return new Response(null, { status: 204 });
  }

  const owners = await unitOwnersOf(unit.name);
  const result = await commit(() =>
    prisma.$transaction(async (tx) => {
      // Where it was when this was decided: fördelad or given elsewhere in
      // another tab a moment ago, it is not this request's to move.
      applied(
        await tx.supplierInvoiceDocument.updateMany({
          where,
          data: {
            ...due,
            resultUnitId: unit.id,
            assignedById: g.actor.id,
            assignedAt: new Date(),
            returnedFrom: null,
            returnNote: null,
          },
        }),
        "supplierInvoice.changedMeanwhile",
      );
      await notify(
        tx,
        "SUPPLIER_INVOICE_ASSIGNED",
        owners,
        documentNotice(
          {
            id: doc.id,
            title: cleanSubject(doc.inboundMail?.subject) ?? null,
            dueDate: dueDate === undefined ? doc.dueDate : due.dueDate ?? null,
          },
          { actor: g.actor.name, unit: unit.name },
        ),
        { exclude: [g.actor.id] },
      );
    }),
  );
  if (result instanceof Response) return result;
  deliverSoon();
  return new Response(null, { status: 204 });
}
