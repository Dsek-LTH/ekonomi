// Utlägg: the list every screen renders, and the full single one behind the
// detail page. Also the place a viewer's scope is applied — which expenses they
// may see at all, and which allocations they may attest.
import "server-only";

import { prisma } from "@/lib/server/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  resultUnitNameForCode,
  getPrefixes,
  ownedResultUnits,
  type PrefixRow,
} from "@/lib/server/result-units";
import { oreToSEK as ore } from "@/lib/domain/money";
import { canAttestAllocation, canReturnApproved } from "@/lib/domain/permissions";
import type { CostAllocation, Expense, Role } from "@/lib/domain/types";
import { expenseScopeOf, expenseScopeWhere, type Viewer } from "./expense-scope";
import { isoDate } from "./shared";

// Map one allocation row (+ its cost-centre/approver relations) to the UI shape.
// Shared by both the list and the detail mappers.
function mapAllocation(
  a: {
    id: string;
    costCenterId: string;
    costCenter: { code: string; name: string };
    amount: number;
    comment: string | null;
    approvedById: string | null;
    approvedBy: { name: string } | null;
    approvedAt: Date | null;
  },
  prefixes: PrefixRow[],
): CostAllocation {
  return {
    id: a.id,
    costCenterId: a.costCenterId,
    costCenterCode: a.costCenter.code,
    costCenterName: a.costCenter.name,
    resultUnit: resultUnitNameForCode(a.costCenter.code, prefixes) ?? undefined,
    amount: ore(a.amount),
    comment: a.comment ?? undefined,
    approvedById: a.approvedById ?? undefined,
    approvedByName: a.approvedBy?.name ?? undefined,
    approvedAt: a.approvedAt?.toISOString() ?? undefined,
  };
}

// Relations needed to render a row in any expense list (no per-expense audit
// timeline and no voucher lines — those are loaded only on the detail page).
const summaryInclude = {
  submitter: true,
  allocations: {
    include: { costCenter: true, approvedBy: true },
  },
  // take: 1 makes the tiebreaker matter twice over — two receipts stored in the
  // same instant would otherwise pick an arbitrary one as "newest". The
  // annotation keeps this array mutable despite the `as const` below, which is
  // what Prisma's argument types require.
  receipts: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }] as Prisma.ReceiptOrderByWithRelationInput[],
    take: 1,
  },
  verification: { include: { createdBy: true } },
} as const;

type SummaryRow = Awaited<
  ReturnType<typeof prisma.expense.findFirstOrThrow<{ include: typeof summaryInclude }>>
>;

function fortnoxLabel(v: { fortnoxSeries: string | null; fortnoxNumber: number | null }): string | undefined {
  return v.fortnoxSeries && v.fortnoxNumber != null ? `${v.fortnoxSeries}-${v.fortnoxNumber}` : undefined;
}

function mapSummary(e: SummaryRow, prefixes: PrefixRow[]): Expense {
  return {
    id: e.reference,
    title: e.title,
    submitterId: e.submitterId,
    submitterName: e.submitter.name,
    allocations: e.allocations.map((a) => mapAllocation(a, prefixes)),
    paymentType: e.paymentType,
    status: (e.status === "REJECTED" ? "CHANGES_REQUESTED" : e.status) as Expense["status"],
    purchaseDate: isoDate(e.purchaseDate),
    grossAmount: ore(e.grossAmount),
    currency: e.currency,
    matchedTransactionId: e.matchedTransactionId ?? undefined,
    receiptId: e.receipts[0]?.id,
    receiptMimeType: e.receipts[0]?.mimeType,
    submitterHasPayout: Boolean(
      e.submitter.bankClearingNumber && e.submitter.bankAccountNumber,
    ),
    verification: e.verification
      ? {
          date: isoDate(e.verification.date),
          description: e.verification.description,
          createdBy: e.verification.createdBy?.name,
          fortnoxLabel: fortnoxLabel(e.verification),
          exportedAt: e.verification.exportedAt?.toISOString() ?? undefined,
          lines: [],
        }
      : undefined,
    revisions: [],
  };
}

export type { Viewer };

// Per-request attest context: the viewer's roles + result units, resolved once,
// plus the prefix table used to place each allocation in a result unit.
type AttestCtx = {
  viewerId: string;
  viewerRoles: Role[];
  ownedResultUnits: string[];
  prefixes: PrefixRow[];
};

async function attestCtx(viewer: Viewer): Promise<AttestCtx> {
  const [owned, prefixes] = await Promise.all([
    ownedResultUnits(viewer),
    getPrefixes(),
  ]);
  return {
    viewerId: viewer.id,
    viewerRoles: viewer.roles,
    ownedResultUnits: owned.names,
    prefixes,
  };
}

// Stamp attest capabilities onto a mapped expense: per-allocation `canAttest`
// (authority for the viewer, regardless of approval state) and expense-level
// `canReturn` (may pull a wrongly-approved expense back).
function annotateAttest(
  raw: {
    submitterId: string;
    submitter: { roles: Role[] };
    allocations: { id: string; costCenter: { code: string } }[];
  },
  mapped: Expense,
  ctx: AttestCtx,
): void {
  const submitterRoles = raw.submitter.roles;
  const actorIsSubmitter = raw.submitterId === ctx.viewerId;
  const resultUnitById = new Map(
    raw.allocations.map((a) => [a.id, resultUnitNameForCode(a.costCenter.code, ctx.prefixes)]),
  );
  for (const a of mapped.allocations) {
    a.canAttest = canAttestAllocation({
      actorRoles: ctx.viewerRoles,
      actorIsSubmitter,
      actorOwnedResultUnits: ctx.ownedResultUnits,
      submitterRoles,
      allocationResultUnit: resultUnitById.get(a.id) ?? null,
    });
  }
  mapped.canReturn = canReturnApproved(ctx.viewerRoles);
}

// Lightweight list for every index/list screen. Omits the audit timeline and
// voucher lines so we don't drag the whole history of every expense to the UI.
// Pass the acting user to scope the result to what they're allowed to see (and
// to stamp attest flags); omit it only for trusted internal callers.
export async function getExpenseSummaries(viewer?: Viewer): Promise<Expense[]> {
  const where = viewer ? expenseScopeWhere(await expenseScopeOf(viewer)) : {};
  const expenses = await prisma.expense.findMany({
    where,
    orderBy: { reference: "desc" },
    include: summaryInclude,
  });
  const [ctx, prefixes] = await Promise.all([
    viewer ? attestCtx(viewer) : null,
    getPrefixes(),
  ]);
  return expenses.map((e) => {
    const mapped = mapSummary(e, prefixes);
    if (ctx) annotateAttest(e, mapped, ctx);
    return mapped;
  });
}

// Full single expense for the detail page — adds the event timeline and the
// verification's voucher lines on top of the summary shape.
export async function getExpense(
  reference: string,
  viewer?: Viewer,
): Promise<Expense | null> {
  // The scope goes into the lookup rather than after it: an expense the viewer
  // may not see is simply not found, which is the answer both callers want
  // anyway (the page renders notFound, the API answers 404).
  const scopeWhere = viewer ? expenseScopeWhere(await expenseScopeOf(viewer)) : {};
  const e = await prisma.expense.findFirst({
    where: { AND: [{ reference }, scopeWhere] },
    include: {
      ...summaryInclude,
      // Several events can be written in one transaction and share a timestamp.
      events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { actor: true } },
      verification: {
        include: {
          createdBy: true,
          lines: { orderBy: { sortOrder: "asc" }, include: { costCenter: true } },
        },
      },
    },
  });
  if (!e) return null;

  const prefixes = await getPrefixes();
  const mapped: Expense = {
    ...mapSummary(e, prefixes),
    verification: e.verification
      ? {
          date: isoDate(e.verification.date),
          description: e.verification.description,
          createdBy: e.verification.createdBy?.name,
          fortnoxLabel: fortnoxLabel(e.verification),
          exportedAt: e.verification.exportedAt?.toISOString() ?? undefined,
          lines: e.verification.lines.map((l) => ({
            id: l.id,
            account: l.account,
            accountName: l.accountName,
            description: l.description ?? undefined,
            costCenterCode: l.costCenter?.code,
            debit: ore(l.debit),
            credit: ore(l.credit),
          })),
        }
      : undefined,
    revisions: e.events.map((ev) => ({
      id: ev.id,
      actor: ev.actor?.name ?? "System",
      action: ev.type,
      comment: ev.comment ?? undefined,
      date: ev.createdAt.toISOString(),
    })),
  };
  if (viewer) annotateAttest(e, mapped, await attestCtx(viewer));
  return mapped;
}
