// One levfaktura: the treasurer's kontering of it, a field at a time.
//
// The kontering (supplier, amount, dates, OCR, and its lines) is the
// treasurer's, once every row is attested and until it is in Fortnox
// (canBook). The head's fields are saved as each is left, the lines together
// when Spara kontering is pressed. Marking the kontering done is
// ./transition's `book`. The fördelning is not changed here: that is the
// unit's, and is sent with its attest.
import { prisma } from "@/lib/server/db";
import { isoToDate } from "@/lib/domain/date";
import { gate } from "@/lib/api/guard";
import { applied, commit } from "@/lib/api/stale-write";
import { denyOutsideFiscalYear } from "@/lib/api/fiscal-year";
import { parseBody } from "@/lib/api/parse";
import { PatchSupplierInvoice } from "@/lib/api/schemas/supplier-invoice";
import { loadInvoiceFor, refuseChange } from "@/lib/api/supplier-invoice-access";
import { isWithTreasury } from "@/lib/domain/supplier-invoice";
import { isoDate } from "@/lib/data/shared";

// The free-text columns, which are copied across as they arrive.
const TEXT_FIELDS = [
  "description",
  "supplierName",
  "supplierOrgNo",
  "invoiceNumber",
  "ocr",
  "bankgiro",
  "plusgiro",
  "yourReference",
  "ourReference",
  "fortnoxSupplierNumber",
] as const;

// How long after one edit the next still counts as the same sitting.
const EDIT_SITTING_MS = 15 * 60 * 1000;

// PATCH /api/supplier-invoices/:id
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PatchSupplierInvoice);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const access = await loadInvoiceFor(g.actor, id);
  if (!access.ok) return access.res;
  const { invoice, can } = access;
  if (!can.canBook) return refuseChange(invoice, isWithTreasury(invoice.status));

  // What changed, by field name, for the history. The values themselves are
  // on the invoice, and a log of every keystroke's worth of old text says less
  // than the one line "Leverantör, belopp ändrade" does.
  const changed: string[] = [];
  const data: Record<string, unknown> = {};

  for (const f of TEXT_FIELDS) {
    const v = body[f];
    if (v === undefined || v === invoice[f]) continue;
    data[f] = v;
    changed.push(f);
  }
  for (const f of ["invoiceDate", "dueDate"] as const) {
    const v = body[f];
    if (v === undefined || v === (isoDate(invoice[f]) || null)) continue;
    // The invoice's own date decides its year, and it is set in the one
    // picked in the header. The due date may fall in the next.
    if (f === "invoiceDate") {
      const offYear = await denyOutsideFiscalYear(v);
      if (offYear) return offYear;
    }
    data[f] = isoToDate(v);
    changed.push(f);
  }
  if (body.amount !== undefined && body.amount !== invoice.amount) {
    data.amount = body.amount;
    changed.push("amount");
  }
  if (body.rounding !== undefined && (body.rounding || null) !== invoice.rounding) {
    data.rounding = body.rounding || null;
    changed.push("rounding");
  }

  // The lines, whole. Changed when they say anything other than what is saved.
  const saved = (
    await prisma.supplierInvoiceLine.findMany({
      where: { invoiceId: invoice.id },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { account: true, costCenterCode: true, project: true, description: true, debit: true, credit: true },
    })
  ).map((l) => JSON.stringify(l));
  const lines = body.lines?.map((l) => ({
    account: l.account,
    costCenterCode: l.costCenterCode ?? null,
    project: l.project ?? null,
    description: l.description ?? null,
    debit: l.debit,
    credit: l.credit,
  }));
  const linesChanged =
    lines !== undefined &&
    (lines.length !== saved.length || lines.some((l, i) => JSON.stringify(l) !== saved[i]));
  if (linesChanged) changed.push("lines");

  if (changed.length === 0) return new Response(null, { status: 204 });

  // A field typed over is the treasurer's now, not the PDF's.
  if (invoice.prefilled.some((f) => changed.includes(f))) {
    data.prefilled = invoice.prefilled.filter((f) => !changed.includes(f));
  }

  const result = await commit(() =>
    prisma.$transaction(async (tx) => {
      // Still in the state it was judged editable in. Exported in another tab
      // a moment ago, it is not this request's to change.
      applied(
        await tx.supplierInvoice.updateMany({ where: { id: invoice.id, status: invoice.status }, data }),
        "supplierInvoice.changedMeanwhile",
      );
      if (linesChanged) {
        await tx.supplierInvoiceLine.deleteMany({ where: { invoiceId: invoice.id } });
        await tx.supplierInvoiceLine.createMany({
          data: lines!.map((l, position) => ({ ...l, invoiceId: invoice.id, position })),
        });
      }
      // The page saves a field at a time, as each is left. One sitting's
      // edits are one line in the history, not one per field.
      const last = await tx.supplierInvoiceEvent.findFirst({
        where: { invoiceId: invoice.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, type: true, actorId: true, createdAt: true, diff: true },
      });
      if (
        last?.type === "EDITED" &&
        last.actorId === g.actor.id &&
        Date.now() - last.createdAt.getTime() < EDIT_SITTING_MS
      ) {
        const before = ((last.diff as { fields?: string[] } | null)?.fields ?? []) as string[];
        await tx.supplierInvoiceEvent.update({
          where: { id: last.id },
          data: { diff: { fields: [...new Set([...before, ...changed])] } },
        });
      } else {
        await tx.supplierInvoiceEvent.create({
          data: { invoiceId: invoice.id, type: "EDITED", actorId: g.actor.id, diff: { fields: changed } },
        });
      }
    }),
  );
  if (result instanceof Response) return result;
  return new Response(null, { status: 204 });
}
