// Drive a levfaktura through its lifecycle. One endpoint, the same shape as an
// utlägg's: every action is checked against invoiceCapabilities (who) and the
// status it was decided under (when), and every write restates that status, so
// two people acting at once get a 409 rather than a muddle.
//
// Export to Fortnox is not here. It is a real call to Fortnox and gets a route
// of its own.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import type { TxClient } from "@/lib/server/tx";
import { attestersOf, deliverSoon, notify } from "@/lib/server/notify";
import { invoiceNotice } from "@/lib/email/content";
import {
  isInvoiceAssignable,
  isInvoiceDiscardable,
  isInvoiceSubmittable,
  submitBlocker,
} from "@/lib/domain/supplier-invoice";
import type { SupplierInvoiceEventType, SupplierInvoiceStatus } from "@/lib/domain/types";
import { fail, gate } from "@/lib/api/guard";
import { applied, commit } from "@/lib/api/stale-write";
import { parseBody } from "@/lib/api/parse";
import { TransitionSupplierInvoice } from "@/lib/api/schemas/supplier-invoice";
import {
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

/** Take every signature off, for an invoice leaving the attest. A signature is
 *  on the kontering as it stood, and the kontering is about to change. */
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
  const { action, comment, resultUnitId } = parsed.data;

  const access = await loadInvoiceFor(actor, id);
  if (!access.ok) return access.res;
  const { invoice, can, mayAttest } = access;

  // One row of the history, by the actor.
  const event = (
    type: SupplierInvoiceEventType,
    extra: { comment?: string | null; diff?: { from: string | null; to: string } } = {},
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

  // ── Give it to a result unit, move it, or take it back ────────────────────
  if (action === "assign") {
    if (!can.canAssign) return refuseChange(invoice, isInvoiceAssignable(invoice.status));
    if (resultUnitId === undefined) return fail(422, "supplierInvoice.noResultUnit");

    if (resultUnitId === null) {
      if (invoice.status === "INBOX") return done("INBOX");
      const result = await commit(() =>
        prisma.$transaction(async (tx) => {
          await move(tx, invoice, "INBOX", {
            resultUnitId: null,
            assignedById: null,
            assignedAt: null,
          });
          await tx.supplierInvoiceEvent.create({ data: event("UNASSIGNED", { comment }) });
        }),
      );
      if (result instanceof NextResponse) return result;
      return done("INBOX");
    }

    const unit = await prisma.resultUnit.findUnique({
      where: { id: resultUnitId },
      select: { id: true, name: true },
    });
    if (!unit) return fail(422, "supplierInvoice.unknownResultUnit");
    if (unit.id === invoice.resultUnitId) return done(invoice.status);

    // Out of the inkorg it becomes ASSIGNED. Moved between units it keeps
    // where it was: an invoice sent back with a comment is still waiting on
    // that comment, whoever answers it now.
    const to: SupplierInvoiceStatus = invoice.status === "INBOX" ? "ASSIGNED" : invoice.status;
    const owners = await unitOwnersOf(unit.name);
    const result = await commit(() =>
      prisma.$transaction(async (tx) => {
        await move(tx, invoice, to, {
          resultUnitId: unit.id,
          assignedById: actor.id,
          assignedAt: new Date(),
        });
        await tx.supplierInvoiceEvent.create({
          data: event("ASSIGNED", {
            comment,
            diff: { from: invoice.resultUnit?.name ?? null, to: unit.name },
          }),
        });
        await notify(
          tx,
          "SUPPLIER_INVOICE_ASSIGNED",
          owners,
          about("assigned", { unit: unit.name }),
          { exclude: [actor.id] },
        );
      }),
    );
    if (result instanceof NextResponse) return result;
    return done(to);
  }

  // ── Out of the inkorg, and back ───────────────────────────────────────────
  if (action === "discard") {
    if (!can.canDiscard) return refuseChange(invoice, isInvoiceDiscardable(invoice.status));
    const result = await commit(() =>
      prisma.$transaction(async (tx) => {
        await move(tx, invoice, "DISCARDED");
        await tx.supplierInvoiceEvent.create({ data: event("DISCARDED", { comment }) });
      }),
    );
    if (result instanceof NextResponse) return result;
    return done("DISCARDED");
  }

  if (action === "restore") {
    if (!can.canRestore) return refuseChange(invoice, invoice.status === "DISCARDED");
    const result = await commit(() =>
      prisma.$transaction(async (tx) => {
        // Back to the inkorg as nobody's, the state INBOX means. Whoever it
        // was given to before is in the history, and triage gives it again.
        await move(tx, invoice, "INBOX", {
          resultUnitId: null,
          assignedById: null,
          assignedAt: null,
        });
        await tx.supplierInvoiceEvent.create({ data: event("RESTORED", { comment }) });
      }),
    );
    if (result instanceof NextResponse) return result;
    return done("INBOX");
  }

  // ── Send it for attest ────────────────────────────────────────────────────
  if (action === "submit") {
    if (!can.canSubmit) return refuseChange(invoice, isInvoiceSubmittable(invoice.status));
    const blocker = submitBlocker({
      supplierName: invoice.supplierName,
      dueDate: invoice.dueDate,
      amount: invoice.amount,
      documentCount: invoice._count.documents,
      allocations: invoice.allocations,
    });
    if (blocker) return fail(422, blocker);

    // Whoever may sign each row. Asked without naming a submitter, because the
    // person sending it is usually the one who signs it, and attestersOf would
    // otherwise count their own unit as having nobody and mail every admin.
    // They are left out of the mail instead: they know.
    const attesters = await attestersOf(
      invoice.allocations.map((a) => ({ costCenterCode: a.costCenter.code })),
      "",
    );
    const result = await commit(() =>
      prisma.$transaction(async (tx) => {
        await move(tx, invoice, "PENDING_APPROVAL");
        await clearSignatures(tx, invoice.id);
        await tx.supplierInvoiceEvent.create({ data: event("SUBMITTED", { comment }) });
        await notify(tx, "SUPPLIER_INVOICE_SUBMITTED", attesters, about("submitted"), {
          exclude: [actor.id],
        });
      }),
    );
    if (result instanceof NextResponse) return result;
    return done("PENDING_APPROVAL");
  }

  if (action === "recall") {
    if (!can.canRecall) return refuseChange(invoice, invoice.status === "PENDING_APPROVAL");
    const result = await commit(() =>
      prisma.$transaction(async (tx) => {
        await move(tx, invoice, "ASSIGNED");
        await clearSignatures(tx, invoice.id);
        await tx.supplierInvoiceEvent.create({ data: event("RECALLED", { comment }) });
      }),
    );
    if (result instanceof NextResponse) return result;
    return done("ASSIGNED");
  }

  // ── Attest ────────────────────────────────────────────────────────────────
  if (action === "approve") {
    if (invoice.status !== "PENDING_APPROVAL") return refuseChange(invoice, false);
    const mine = invoice.allocations.filter((a, i) => mayAttest[i] && !a.approvedById);
    if (mine.length === 0) return fail(403, "supplierInvoice.nothingToApprove");

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
        await tx.supplierInvoiceEvent.create({ data: event("COST_CENTER_APPROVED") });

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

  // ── Send it back ──────────────────────────────────────────────────────────
  // action === "request_changes"
  if (!can.canRequestChanges) {
    return refuseChange(
      invoice,
      invoice.status === "PENDING_APPROVAL" || invoice.status === "APPROVED",
    );
  }
  if (!comment) return fail(422, "supplierInvoice.commentRequired");

  const owners = invoice.resultUnit ? await unitOwnersOf(invoice.resultUnit.name) : [];
  const result = await commit(() =>
    prisma.$transaction(async (tx) => {
      await move(tx, invoice, "CHANGES_REQUESTED");
      await clearSignatures(tx, invoice.id);
      await tx.supplierInvoiceEvent.create({ data: event("CHANGES_REQUESTED", { comment }) });
      await notify(tx, "SUPPLIER_INVOICE_ASSIGNED", owners, about("returned"), {
        exclude: [actor.id],
      });
    }),
  );
  if (result instanceof NextResponse) return result;
  return done("CHANGES_REQUESTED");
}
