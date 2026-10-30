// A unit's fördelning of a levfaktura, checked and planned: which cost centres
// take how much, and which rows the sender signs as they send it. The one
// place that knows it, because a fördelning is sent from two places: a
// document in the unit's Inkorg, which it makes into an invoice
// (api/supplier-invoices), and an invoice the unit has to fördela again
// (api/supplier-invoices/[id]/transition).
import "server-only";

import type { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { attestersOf } from "@/lib/server/notify";
import { attestBlocker } from "@/lib/domain/supplier-invoice";
import { fail } from "@/lib/api/guard";
import type { KonteringRow } from "@/lib/api/schemas/supplier-invoice";
import type { SupplierInvoiceStatus } from "@/lib/domain/types";
import { mayAttest, type InvoiceViewerCtx } from "@/lib/data/supplier-invoices";

export interface PlannedRow {
  code: string;
  data: {
    costCenterId: string;
    amount: number | null;
    comment: string | null;
    position: number;
    approvedById: string | null;
    approvedAt: Date | null;
  };
}

export interface AllocationPlan {
  planned: PlannedRow[];
  /** The codes of the rows signed as it is sent. */
  signed: string[];
  /** APPROVED when every row is the sender's to sign, else PENDING_APPROVAL. */
  status: SupplierInvoiceStatus;
  /** Whoever is left to sign, to be asked. */
  attesters: string[];
}

/**
 * Check a fördelning and plan its rows, or the refusal. A retired cost centre
 * is refused unless the invoice already had it (`kept`), so retiring one
 * strands nothing.
 */
export async function planAllocation(f: {
  rows: readonly KonteringRow[];
  /** The amount it is split against, öre. */
  total: number;
  documentCount: number;
  viewer: InvoiceViewerCtx;
  actorId: string;
  kept?: readonly string[];
}): Promise<{ ok: true; plan: AllocationPlan } | { ok: false; res: NextResponse }> {
  const { rows } = f;
  const blocker = attestBlocker({
    documentCount: f.documentCount,
    rows: rows.map((r) => ({ amount: rows.length === 1 ? null : (r.amount ?? null) })),
    invoiceAmount: f.total,
  });
  if (blocker) return { ok: false, res: fail(422, blocker) };

  const codes = [...new Set(rows.map((r) => r.costCenterCode.toUpperCase()))];
  const had = new Set(f.kept ?? []);
  const centres = await prisma.costCenter.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, active: true },
  });
  const byCode = new Map(centres.map((c) => [c.code, c]));
  for (const code of codes) {
    const c = byCode.get(code);
    if (!c || (!c.active && !had.has(code))) {
      return { ok: false, res: fail(422, "supplierInvoice.unknownCostCenter", { values: { code } }) };
    }
  }

  const now = new Date();
  const planned = rows.map((r, position) => {
    const code = r.costCenterCode.toUpperCase();
    const mine = mayAttest(f.viewer, code);
    return {
      code,
      data: {
        costCenterId: byCode.get(code)!.id,
        amount: rows.length === 1 ? null : (r.amount ?? null),
        comment: r.comment ?? null,
        position,
        approvedById: mine ? f.actorId : null,
        approvedAt: mine ? now : null,
      },
    };
  });
  const waiting = planned.filter((p) => !p.data.approvedById);
  // Asked without naming a submitter: the sender has signed what they could,
  // and is left out of the mail instead.
  const attesters = waiting.length
    ? await attestersOf(waiting.map((w) => ({ costCenterCode: w.code })), "")
    : [];
  return {
    ok: true,
    plan: {
      planned,
      signed: planned.filter((p) => p.data.approvedById).map((p) => p.code),
      status: waiting.length === 0 ? "APPROVED" : "PENDING_APPROVAL",
      attesters,
    },
  };
}
