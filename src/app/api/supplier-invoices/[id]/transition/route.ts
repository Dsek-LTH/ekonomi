// Drive a levfaktura through its lifecycle. One endpoint, the same shape as an
// utlägg's: every action is checked against invoiceCapabilities (who) and the
// status it was decided under (when), and every write restates that status, so
// two people acting at once get a 409 rather than a muddle.
//
// The attest is also the kontering. Picking the cost centre and pressing
// Attestera sends both, and the rows the attester may sign are signed in the
// same write. Only a split onto another unit's cost centre waits, in
// PENDING_APPROVAL, for that unit's signature.
//
// Export to Fortnox is not here. It is a real call to Fortnox and gets a route
// of its own.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import type { TxClient } from "@/lib/server/tx";
import { attestersOf, deliverSoon, notify } from "@/lib/server/notify";
import { invoiceNotice } from "@/lib/email/content";
import { attestBlocker, awaitsKontering, isInvoiceReturnable } from "@/lib/domain/supplier-invoice";
import type { SupplierInvoiceEventType, SupplierInvoiceStatus } from "@/lib/domain/types";
import { fail, gate } from "@/lib/api/guard";
import { applied, commit } from "@/lib/api/stale-write";
import { parseBody } from "@/lib/api/parse";
import { TransitionSupplierInvoice } from "@/lib/api/schemas/supplier-invoice";
import { mayAttest as viewerMayAttest } from "@/lib/data/supplier-invoices";
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
  const { action, comment, resultUnitId, rows } = parsed.data;

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

  // ── Kontera and attest ────────────────────────────────────────────────────
  if (action === "attest") {
    if (can.canKontera) {
      if (!rows) return fail(422, "supplierInvoice.noAllocations");
      const blocker = attestBlocker({
        documentCount: invoice._count.documents,
        rows: rows.map((r) => ({ amount: rows.length === 1 ? null : (r.amount ?? null) })),
        invoiceAmount: invoice.amount,
      });
      if (blocker) return fail(422, blocker);

      // The cost centres, by code. A retired one is refused unless the
      // invoice already had it, so retiring one strands nothing.
      const codes = [...new Set(rows.map((r) => r.costCenterCode.toUpperCase()))];
      const had = new Set(invoice.allocations.map((a) => a.costCenter.code));
      const centres = await prisma.costCenter.findMany({
        where: { code: { in: codes } },
        select: { id: true, code: true, active: true },
      });
      const byCode = new Map(centres.map((c) => [c.code, c]));
      for (const code of codes) {
        const c = byCode.get(code);
        if (!c || (!c.active && !had.has(code))) {
          return fail(422, "supplierInvoice.unknownCostCenter", { values: { code } });
        }
      }

      const now = new Date();
      const planned = rows.map((r, position) => {
        const code = r.costCenterCode.toUpperCase();
        const mine = viewerMayAttest(viewer, code);
        return {
          code,
          data: {
            costCenterId: byCode.get(code)!.id,
            amount: rows.length === 1 ? null : (r.amount ?? null),
            comment: r.comment ?? null,
            position,
            approvedById: mine ? actor.id : null,
            approvedAt: mine ? now : null,
          },
        };
      });
      const signed = planned.filter((p) => p.data.approvedById);
      const waiting = planned.filter((p) => !p.data.approvedById);
      const to: SupplierInvoiceStatus = waiting.length === 0 ? "APPROVED" : "PENDING_APPROVAL";

      // Whoever is left to sign. Asked without naming a submitter: the actor
      // has signed what they could, and is left out of the mail instead.
      const attesters = waiting.length
        ? await attestersOf(waiting.map((w) => ({ costCenterCode: w.code })), "")
        : [];

      const result = await commit(() =>
        prisma.$transaction(async (tx) => {
          await move(tx, invoice, to);
          await tx.supplierInvoiceAllocation.deleteMany({ where: { invoiceId: invoice.id } });
          await tx.supplierInvoiceAllocation.createMany({
            data: planned.map((p) => ({ ...p.data, invoiceId: invoice.id })),
          });
          if (signed.length) {
            await tx.supplierInvoiceEvent.create({
              data: event("COST_CENTER_APPROVED", { comment, diff: { costCenters: signed.map((s) => s.code) } }),
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
      return refuseChange(invoice, awaitsKontering(invoice.status) || invoice.status === "PENDING_APPROVAL");
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
      return refuseChange(invoice, invoice.status === "PENDING_APPROVAL" || invoice.status === "APPROVED");
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

  // ── Send it back ──────────────────────────────────────────────────────────
  // action === "request_changes"
  if (!can.canRequestChanges) {
    return refuseChange(invoice, invoice.status === "PENDING_APPROVAL" || invoice.status === "APPROVED");
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
