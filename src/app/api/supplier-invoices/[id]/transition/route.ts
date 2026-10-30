// Drive a levfaktura through its lifecycle. One endpoint, the same shape as an
// utlägg's: every action is checked against invoiceCapabilities (who) and the
// status it was decided under (when), and every write restates that status, so
// two people acting at once get a 409 rather than a muddle.
//
// The unit's fördelning is sent with its attest: the cost centres, and the
// amount, due date and description it read off the invoice. The rows the
// sender may sign are signed in the same write. Only a split onto another
// unit's cost centre waits, in PENDING_APPROVAL, for that unit's signature.
// The first fördelning is not here: it is what makes the invoice, from a
// document in the unit's Inkorg (../../route.ts). This is the unit fördela an
// invoice again, once its split was reopened or its signature taken back.
//
// The treasury's kontering is saved a field at a time (../route.ts PATCH) and
// marked done here (`book`). Sending it to Fortnox is not here: it is a real
// call to Fortnox and gets a route of its own.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import type { TxClient } from "@/lib/server/tx";
import { deliverSoon, notify } from "@/lib/server/notify";
import { invoiceNotice } from "@/lib/email/content";
import {
  awaitsAllocation,
  exportBlocker,
  isInvoiceReturnable,
  isWithTreasury,
} from "@/lib/domain/supplier-invoice";
import { isoToDate } from "@/lib/domain/date";
import { isoDate } from "@/lib/data/shared";
import { readInvoiceScan } from "@/lib/server/invoice-documents";
import { prefillData } from "@/lib/server/invoice-prefill";
import type { SupplierInvoiceEventType, SupplierInvoiceStatus } from "@/lib/domain/types";
import { fail, gate } from "@/lib/api/guard";
import { applied, commit } from "@/lib/api/stale-write";
import { parseBody } from "@/lib/api/parse";
import { TransitionSupplierInvoice } from "@/lib/api/schemas/supplier-invoice";
import { planAllocation } from "@/lib/server/invoice-allocation";
import {
  exportFactsOf,
  loadInvoiceFor,
  refuseChange,
  unitOwnersOf,
  type LoadedInvoice,
} from "@/lib/api/supplier-invoice-access";

const STALE = "supplierInvoice.changedMeanwhile";

/** Move the invoice from the status it was read in, or fail as stale. */
async function move(
  tx: TxClient,
  invoice: LoadedInvoice,
  to: SupplierInvoiceStatus,
  extra: Record<string, unknown> = {},
) {
  applied(
    await tx.supplierInvoice.updateMany({
      where: { id: invoice.id, status: invoice.status },
      data: { status: to, ...extra },
    }),
    STALE,
  );
}

/** Take every signature off. A signature is on the kontering as it stood, and
 *  an invoice sent back is about to be konterad again. */
const clearSignatures = (tx: TxClient, invoiceId: string) =>
  tx.supplierInvoiceAllocation.updateMany({
    where: { invoiceId },
    data: { approvedById: null, approvedAt: null },
  });

// POST /api/supplier-invoices/:id/transition
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;
  const actor = g.actor;

  const parsed = await parseBody(req, TransitionSupplierInvoice);
  if (!parsed.ok) return parsed.res;
  const { action, comment, resultUnitId, rows, amount, dueDate, description } = parsed.data;

  const access = await loadInvoiceFor(actor, id);
  if (!access.ok) return access.res;
  const { invoice, can, mayAttest, viewer } = access;

  // One row of the history, by the actor.
  const event = (
    type: SupplierInvoiceEventType,
    extra: { comment?: string | null; diff?: object } = {},
  ) => ({
    invoiceId: invoice.id,
    type,
    actorId: actor.id,
    comment: extra.comment ?? null,
    ...(extra.diff && { diff: extra.diff }),
  });

  // The mail about this invoice, as of the action being taken.
  const about = (
    key: Parameters<typeof invoiceNotice>[0],
    values: Record<string, string | number> = {},
  ) =>
    invoiceNotice(
      key,
      invoice,
      { actor: actor.name, unit: invoice.resultUnit?.name ?? "", ...values },
      { author: actor.name, text: comment || null },
    );

  const done = (status: SupplierInvoiceStatus) => {
    deliverSoon();
    return NextResponse.json({ id: invoice.id, status });
  };

  // ── Give it to another unit instead ───────────────────────────────────────
  // Only while nothing on it is signed. It keeps where it was: an invoice sent
  // back with a comment is still waiting on that comment, whoever answers it
  // now. Sending it back to the Inkorg is not a move but ../return, since an
  // invoice without a unit is not one.
  if (action === "assign") {
    if (!can.canMove) return refuseChange(invoice, isInvoiceReturnable(invoice.status));
    if (!resultUnitId) return fail(422, "supplierInvoice.noResultUnit");

    const unit = await prisma.resultUnit.findUnique({
      where: { id: resultUnitId },
      select: { id: true, name: true },
    });
    if (!unit) return fail(422, "supplierInvoice.unknownResultUnit");
    if (unit.id === invoice.resultUnitId) return done(invoice.status);

    const owners = await unitOwnersOf(unit.name);
    const result = await commit(() =>
      prisma.$transaction(async (tx) => {
        await move(tx, invoice, invoice.status, {
          resultUnitId: unit.id,
          assignedById: actor.id,
          assignedAt: new Date(),
        });
        await tx.supplierInvoiceEvent.create({
          data: event("ASSIGNED", { comment, diff: { from: invoice.resultUnit?.name ?? null, to: unit.name } }),
        });
        await notify(tx, "SUPPLIER_INVOICE_ASSIGNED", owners, about("assigned", { unit: unit.name }), {
          exclude: [actor.id],
        });
      }),
    );
    if (result instanceof NextResponse) return result;
    return done(invoice.status);
  }

  // ── Fördela and attest ────────────────────────────────────────────────────
  if (action === "attest") {
    if (can.canAllocate) {
      if (!rows) return fail(422, "supplierInvoice.noAllocations");
      // The amount the split is made against and the date it is due by, as
      // the unit read them off the invoice. The page offers what the PDF
      // says, and the treasury checks both again at the kontering.
      const total = amount ?? invoice.amount;
      if (total == null) return fail(422, "supplierInvoice.noAmount");
      const due = dueDate ?? (isoDate(invoice.dueDate) || null);
      if (!due) return fail(422, "supplierInvoice.noDueDate");
      const planning = await planAllocation({
        rows,
        total,
        documentCount: invoice._count.documents,
        viewer,
        actorId: actor.id,
        kept: invoice.allocations.map((a) => a.costCenter.code),
      });
      if (!planning.ok) return planning.res;
      const { planned, signed, status: to, attesters } = planning.plan;

      // What the PDF says fills whatever the invoice still lacks, for the
      // treasury to check. Read before the transaction, since storage and the
      // PDF reader are slow; the page that sent this has read it already, so
      // it is usually kept. What the unit typed is theirs, not the PDF's.
      const reading = await readInvoiceScan(invoice.id);
      const typed = {
        amount: total,
        dueDate: isoToDate(due),
        ...(description !== undefined && { description }),
      };
      const filled = prefillData({ ...invoice, ...typed }, reading.fields, reading.supplier);
      const prefilled = ((filled.prefilled as string[] | undefined) ?? invoice.prefilled).filter(
        (f) => f !== "amount" && f !== "dueDate",
      );

      const result = await commit(() =>
        prisma.$transaction(async (tx) => {
          await move(tx, invoice, to, { ...filled, ...typed, prefilled });
          await tx.supplierInvoiceAllocation.deleteMany({ where: { invoiceId: invoice.id } });
          // A kontering made from the split that is going goes with it.
          await tx.supplierInvoiceLine.deleteMany({ where: { invoiceId: invoice.id } });
          await tx.supplierInvoiceAllocation.createMany({
            data: planned.map((p) => ({ ...p.data, invoiceId: invoice.id })),
          });
          if (signed.length) {
            await tx.supplierInvoiceEvent.create({
              data: event("COST_CENTER_APPROVED", { comment, diff: { costCenters: signed } }),
            });
          }
          if (to === "APPROVED") await tx.supplierInvoiceEvent.create({ data: event("APPROVED") });
          if (attesters.length) {
            await notify(tx, "SUPPLIER_INVOICE_SUBMITTED", attesters, about("submitted"), {
              exclude: [actor.id],
            });
          }
        }),
      );
      if (result instanceof NextResponse) return result;
      return done(to);
    }

    // Another unit's share of a split, signed as it stands.
    if (!can.canAttest) {
      return refuseChange(invoice, awaitsAllocation(invoice.status) || invoice.status === "PENDING_APPROVAL");
    }
    const mine = invoice.allocations.filter((a, i) => mayAttest[i] && !a.approvedById);
    const now = new Date();
    const result = await commit(() =>
      prisma.$transaction(async (tx) => {
        // Still unsigned is part of the condition, so a signature somebody
        // else put there in the meantime is never written over with ours.
        applied(
          await tx.supplierInvoiceAllocation.updateMany({
            where: { id: { in: mine.map((a) => a.id) }, approvedById: null },
            data: { approvedById: actor.id, approvedAt: now },
          }),
          "supplierInvoice.alreadyAttested",
        );
        await tx.supplierInvoiceEvent.create({
          data: event("COST_CENTER_APPROVED", { comment, diff: { costCenters: mine.map((a) => a.costCenter.code) } }),
        });
        const remaining = await tx.supplierInvoiceAllocation.count({
          where: { invoiceId: invoice.id, approvedById: null },
        });
        if (remaining > 0) return "PENDING_APPROVAL" as const;
        await move(tx, invoice, "APPROVED");
        await tx.supplierInvoiceEvent.create({ data: event("APPROVED") });
        return "APPROVED" as const;
      }),
    );
    if (result instanceof NextResponse) return result;
    return done(result);
  }

  // ── Take your own signature back ──────────────────────────────────────────
  if (action === "withdraw_attest") {
    if (!can.canWithdrawAttest) {
      return refuseChange(invoice, invoice.status === "PENDING_APPROVAL" || isWithTreasury(invoice.status));
    }
    const mine = invoice.allocations.filter((a) => a.approvedById === actor.id);
    // The last signature gone, it is back to waiting for its kontering, which
    // is where the person who withdrew it can change it. Others' signatures
    // stay on their rows.
    const othersSigned = invoice.allocations.some((a) => a.approvedById && a.approvedById !== actor.id);
    const to: SupplierInvoiceStatus = othersSigned ? "PENDING_APPROVAL" : "ASSIGNED";
    const result = await commit(() =>
      prisma.$transaction(async (tx) => {
        applied(
          await tx.supplierInvoiceAllocation.updateMany({
            where: { id: { in: mine.map((a) => a.id) }, approvedById: actor.id },
            data: { approvedById: null, approvedAt: null },
          }),
          STALE,
        );
        await move(tx, invoice, to);
        await tx.supplierInvoiceEvent.create({ data: event("ATTEST_WITHDRAWN", { comment }) });
      }),
    );
    if (result instanceof NextResponse) return result;
    return done(to);
  }

  // ── Change the split ──────────────────────────────────────────────────────
  // The unit that proposed it, while others are still signing. Every
  // signature comes off, its own too, because each was given to the split as
  // it stood. Back to waiting for its kontering, and whoever signs next is
  // asked when the new split is sent.
  if (action === "redistribute") {
    if (!can.canRedistribute) return refuseChange(invoice, invoice.status === "PENDING_APPROVAL");
    const result = await commit(() =>
      prisma.$transaction(async (tx) => {
        await move(tx, invoice, "ASSIGNED");
        await clearSignatures(tx, invoice.id);
        await tx.supplierInvoiceEvent.create({ data: event("ATTEST_WITHDRAWN", { comment, diff: { all: true } }) });
      }),
    );
    if (result instanceof NextResponse) return result;
    return done("ASSIGNED");
  }

  // ── The treasury's kontering, done ────────────────────────────────────────
  // Every field is already saved as it was left. This says the kontering is
  // finished, which is only true when what is saved is enough to send. Done
  // again on a konterad invoice (Ändra kontering), it only checks.
  if (action === "book") {
    if (!can.canBook) return refuseChange(invoice, isWithTreasury(invoice.status));
    const blocker = exportBlocker(exportFactsOf(invoice));
    if (blocker) return fail(422, blocker);
    if (invoice.status === "BOOKED") return done("BOOKED");
    const result = await commit(() =>
      prisma.$transaction(async (tx) => {
        await move(tx, invoice, "BOOKED");
        await tx.supplierInvoiceEvent.create({ data: event("BOOKED", { comment }) });
      }),
    );
    if (result instanceof NextResponse) return result;
    return done("BOOKED");
  }

  // ── Send it back ──────────────────────────────────────────────────────────
  // action === "request_changes"
  if (!can.canRequestChanges) {
    return refuseChange(invoice, invoice.status === "PENDING_APPROVAL" || isWithTreasury(invoice.status));
  }
  if (!comment) return fail(422, "supplierInvoice.commentRequired");

  const owners = invoice.resultUnit ? await unitOwnersOf(invoice.resultUnit.name) : [];
  const result = await commit(() =>
    prisma.$transaction(async (tx) => {
      await move(tx, invoice, "CHANGES_REQUESTED");
      await clearSignatures(tx, invoice.id);
      await tx.supplierInvoiceEvent.create({ data: event("CHANGES_REQUESTED", { comment }) });
      await notify(tx, "SUPPLIER_INVOICE_ASSIGNED", owners, about("returned"), { exclude: [actor.id] });
    }),
  );
  if (result instanceof NextResponse) return result;
  return done("CHANGES_REQUESTED");
}
