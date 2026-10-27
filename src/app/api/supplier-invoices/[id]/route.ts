// Change what a levfaktura says and how it is konterad.
//
// Who may, and when, is invoiceCapabilities' canEdit: triage while it sits in
// the inkorg, and the unit's resultatansvarig (or triage, or an admin) once it
// has been given to one, until it goes for attest. Nothing is changed under
// an attester who is reading it.
import { prisma } from "@/lib/server/db";
import { isInvoiceEditable } from "@/lib/domain/supplier-invoice";
import { isoToDate } from "@/lib/domain/date";
import { fail, gate } from "@/lib/api/guard";
import { applied, commit } from "@/lib/api/stale-write";
import { parseBody } from "@/lib/api/parse";
import { PatchSupplierInvoice } from "@/lib/api/schemas/supplier-invoice";
import { loadInvoiceFor, refuseChange } from "@/lib/api/supplier-invoice-access";
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
] as const;

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
  if (!can.canEdit) return refuseChange(invoice, isInvoiceEditable(invoice.status));

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
    data[f] = isoToDate(v);
    changed.push(f);
  }
  if (body.amount !== undefined && body.amount !== invoice.amount) {
    data.amount = body.amount;
    changed.push("amount");
  }

  // The kontering, resolved from codes to rows. A retired cost centre is
  // refused unless it is already on this invoice, so retiring one does not
  // strand an invoice konterad onto it before it was retired.
  let allocations: {
    costCenterId: string;
    account: string;
    project: string | null;
    amount: number;
    comment: string | null;
    position: number;
  }[] | null = null;
  if (body.allocations) {
    const codes = [...new Set(body.allocations.map((a) => a.costCenterCode.toUpperCase()))];
    const onInvoice = new Set(invoice.allocations.map((a) => a.costCenter.code));
    const centres = await prisma.costCenter.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true, active: true },
    });
    const byCode = new Map(centres.map((c) => [c.code, c]));
    for (const code of codes) {
      const c = byCode.get(code);
      if (!c || (!c.active && !onInvoice.has(code))) {
        return fail(422, "supplierInvoice.unknownCostCenter", { values: { code } });
      }
    }
    allocations = body.allocations.map((a, position) => ({
      costCenterId: byCode.get(a.costCenterCode.toUpperCase())!.id,
      account: a.account,
      project: a.project ?? null,
      amount: a.amount,
      comment: a.comment ?? null,
      position,
    }));
    const before = invoice.allocations
      .map((a) => [a.costCenterId, a.account, a.project, a.amount, a.comment].join("|"))
      .join("\n");
    const after = allocations
      .map((a) => [a.costCenterId, a.account, a.project, a.amount, a.comment].join("|"))
      .join("\n");
    if (before !== after) changed.push("allocations");
  }

  if (changed.length === 0) return new Response(null, { status: 204 });

  const result = await commit(() =>
    prisma.$transaction(async (tx) => {
      // Still in the state it was judged editable in. Sent for attest in
      // another tab a moment ago, it is not this request's to change.
      applied(
        await tx.supplierInvoice.updateMany({
          where: { id: invoice.id, status: invoice.status },
          data,
        }),
        "supplierInvoice.changedMeanwhile",
      );
      if (allocations && changed.includes("allocations")) {
        await tx.supplierInvoiceAllocation.deleteMany({ where: { invoiceId: invoice.id } });
        await tx.supplierInvoiceAllocation.createMany({
          data: allocations.map((a) => ({ ...a, invoiceId: invoice.id })),
        });
      }
      await tx.supplierInvoiceEvent.create({
        data: {
          invoiceId: invoice.id,
          type: "EDITED",
          actorId: g.actor.id,
          diff: { fields: changed },
        },
      });
    }),
  );
  if (result instanceof Response) return result;
  return new Response(null, { status: 204 });
}
