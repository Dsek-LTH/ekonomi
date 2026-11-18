// Triage gives a document in the Inkorg to a unit, which makes it a levfaktura (lib/server/invoice-assign.ts).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { deliverSoon } from "@/lib/server/notify";
import { assignDocument } from "@/lib/server/invoice-assign";
import { withReferenceRetry } from "@/lib/server/expense-reference";
import { isoToDate, today } from "@/lib/domain/date";
import { fail, gate } from "@/lib/api/guard";
import { denyOutsideFiscalYear } from "@/lib/api/fiscal-year";
import { commit } from "@/lib/api/stale-write";
import { parseBody } from "@/lib/api/parse";
import { AssignInvoiceDocument } from "@/lib/api/schemas/supplier-invoice";
import { loadInboxDocumentFor } from "@/lib/api/supplier-invoice-access";

// POST /api/supplier-invoice-documents/:id/assign: { resultUnitId, dueDate? } -> { id } of the invoice made
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

  // Made today, with no invoice date until the unit fördelar it, so it lands in this year's Fakturor.
  const offYear = await denyOutsideFiscalYear(today());
  if (offYear) return offYear;

  const { dueDate } = parsed.data;
  const result = await commit(() =>
    withReferenceRetry(() =>
      prisma.$transaction((tx) =>
        assignDocument(tx, {
          doc,
          unit,
          actor: { id: g.actor.id, name: g.actor.name },
          dueDate: dueDate ? isoToDate(dueDate) : null,
        }),
      ),
    ),
  );
  if (result instanceof NextResponse) return result;
  deliverSoon();
  return NextResponse.json(result, { status: 201 });
}
