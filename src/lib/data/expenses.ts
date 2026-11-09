import "server-only";

import { prisma } from "@/lib/server/db";
import type { During } from "@/lib/server/fiscal-year";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ExpenseStatus as DbExpenseStatus } from "@/lib/generated/prisma/enums";
import {
  resultUnitNameForCode,
  getPrefixes,
  ownedResultUnits,
  type PrefixRow,
} from "@/lib/server/result-units";
import { oreToSEK as ore } from "@/lib/domain/money";
import { journeyKm } from "@/lib/mileage/claim";
import { correctionOf } from "@/lib/domain/correction";
import {
  canBookkeep,
  canAttestAllocation,
  canReturnApproved,
  hasAttestRole,
} from "@/lib/domain/permissions";
import type {
  Capability,
  CostAllocation,
  Expense,
  Role,
  Verification,
  VerificationLine,
} from "@/lib/domain/types";
import { expenseScopeOf, expenseScopeWhere, type Viewer } from "./expense-scope";
import { attestScopeWhere } from "./attest-scope";
import {
  dateRangeFilter,
  pageBounds,
  type ListQuery,
  type RowPage,
  type SortDir,
} from "./list-query";
import { isoDate } from "./shared";
import { RECEIPT_ORDER } from "./receipt-order";
import type { ExpenseFingerprint } from "@/lib/domain/duplicates";

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

// Relations needed to render a row in any list (no audit timeline or voucher lines; detail only).
const summaryInclude = {
  submitter: true,
  // Only the name, so a standing dispens can say whose it is.
  deadlineWaivedBy: { select: { name: true } },
  allocations: {
    // By cost-centre code (lib/expense/document.ts); without an order Postgres reshuffles updated rows
    // under the reader. Cast for the same reason as the receipts' order below.
    orderBy: [
      { costCenter: { code: "asc" } },
      { id: "asc" },
    ] as Prisma.ExpenseCostAllocationOrderByWithRelationInput[],
    include: { costCenter: true, approvedBy: true },
  },
  // Every receipt in the submitter's order (RECEIPT_ORDER), also the staple order for Fortnox (lib/server/pdf-merge.ts).
  // The annotation keeps this array mutable despite the `as const` below, as Prisma's argument types require.
  receipts: {
    orderBy: RECEIPT_ORDER as Prisma.ReceiptOrderByWithRelationInput[],
    select: { id: true, filename: true, mimeType: true },
  },
  verification: { include: { createdBy: true } },
} as const;

type SummaryRow = Awaited<
  ReturnType<typeof prisma.expense.findFirstOrThrow<{ include: typeof summaryInclude }>>
>;

function fortnoxLabel(v: {
  fortnoxSeries: string | null;
  fortnoxNumber: number | null;
}): string | undefined {
  return v.fortnoxSeries && v.fortnoxNumber != null
    ? `${v.fortnoxSeries}-${v.fortnoxNumber}`
    : undefined;
}

// One shape for the booked voucher, with or without its rows (`lines`): lists want the heading only.
function mapVerification(
  v: NonNullable<SummaryRow["verification"]>,
  lines: VerificationLine[] = [],
): Verification {
  return {
    date: isoDate(v.date),
    description: v.description,
    createdBy: v.createdBy?.name,
    fortnoxLabel: fortnoxLabel(v),
    exportedAt: v.exportedAt?.toISOString() ?? undefined,
    lines,
  };
}

function mapSummary(e: SummaryRow, prefixes: PrefixRow[]): Expense {
  return {
    id: e.id,
    // Absent until the utlägg is submitted for attest.
    reference: e.reference ?? undefined,
    title: e.title,
    submitterId: e.submitterId,
    submitterName: e.submitter.name,
    submitterStudentId: e.submitter.studentId,
    allocations: e.allocations.map((a) => mapAllocation(a, prefixes)),
    paymentType: e.paymentType,
    status: e.status,
    purchaseDate: isoDate(e.purchaseDate),
    grossAmount: ore(e.grossAmount),
    currency: e.currency,
    matchedTransactionId: e.matchedTransactionId ?? undefined,
    receipts: e.receipts.map((r) => ({ id: r.id, filename: r.filename, mimeType: r.mimeType })),
    // Absent, not empty, for anything that is not a milersättning (the readings live on the utlägg).
    mileage:
      e.paymentType === "MILEAGE"
        ? {
            odometerStart: e.odometerStart == null ? null : Number(e.odometerStart),
            odometerEnd: e.odometerEnd == null ? null : Number(e.odometerEnd),
            stops: e.journeyStops,
            km: journeyKm(
              e.odometerStart == null ? null : Number(e.odometerStart),
              e.odometerEnd == null ? null : Number(e.odometerEnd),
            ),
            orePerKm: e.mileageOrePerKm,
          }
        : undefined,
    submitterHasPayout: Boolean(e.submitter.bankClearingNumber && e.submitter.bankAccountNumber),
    verification: e.verification ? mapVerification(e.verification) : undefined,
    // All three columns or none: the route writes and clears them together. Absent is the safe reading, since a dispens lifts the filing deadline.
    deadlineWaiver:
      e.deadlineWaivedAt && e.deadlineWaiverReason
        ? {
            by: e.deadlineWaivedBy?.name ?? "-",
            at: e.deadlineWaivedAt.toISOString(),
            reason: e.deadlineWaiverReason,
          }
        : undefined,
    revisions: [],
    updatedAt: e.updatedAt.toISOString(),
  };
}

export type { Viewer };

/** The names a REMINDER_SENT event stored in `diff`. See ExpenseEventType. */
function reminderRecipients(diff: unknown): string[] {
  const names = (diff as { recipients?: unknown } | null)?.recipients;
  return Array.isArray(names) ? names.filter((n): n is string => typeof n === "string") : [];
}

// Per-request attest context: the viewer's capabilities, roles and answerable units, plus the prefix table
// placing each allocation in a result unit. Both roles and capabilities, as canAttestAllocation reads both.
type AttestCtx = {
  viewerId: string;
  viewerRoles: Role[];
  viewerCapabilities: Capability[];
  ownedResultUnits: string[];
  prefixes: PrefixRow[];
};

async function attestCtx(viewer: Viewer): Promise<AttestCtx> {
  const [owned, prefixes] = await Promise.all([ownedResultUnits(viewer), getPrefixes()]);
  return {
    viewerId: viewer.id,
    viewerRoles: viewer.roles,
    viewerCapabilities: viewer.capabilities,
    ownedResultUnits: owned.names,
    prefixes,
  };
}

// Stamp attest capabilities on a mapped expense: per-allocation `canAttest`, expense-level `canReturn`.
function annotateAttest(
  raw: {
    submitterId: string;
    submitter: { roles: Role[] };
    allocations: { id: string; costCenter: { code: string } }[];
  },
  mapped: Expense,
  ctx: AttestCtx,
): void {
  const actorIsSubmitter = raw.submitterId === ctx.viewerId;
  const resultUnitById = new Map(
    raw.allocations.map((a) => [a.id, resultUnitNameForCode(a.costCenter.code, ctx.prefixes)]),
  );
  for (const a of mapped.allocations) {
    a.canAttest = canAttestAllocation({
      actorCapabilities: ctx.viewerCapabilities,
      actorRoles: ctx.viewerRoles,
      actorIsSubmitter,
      actorOwnedResultUnits: ctx.ownedResultUnits,
      allocationResultUnit: resultUnitById.get(a.id) ?? null,
    });
  }
  mapped.canReturn = canReturnApproved(ctx.viewerCapabilities);
}

/** Which slice of the section's utlägg a list screen is about ("the attest queue"), before anything the reader typed. */
export type ExpenseListScope =
  | { kind: "all" }
  | { kind: "mine" }
  /** The viewer's own result units' utlägg, not everything they may attest (attest-scope.ts). */
  | { kind: "attestable" };

// The stage tabs (app/(app)/expenses/scope.ts) as statuses. Utkast holds the returned ones too. "all" is absent and narrows nothing.
const STATUS_TAB: Record<string, DbExpenseStatus[]> = {
  draft: ["DRAFT", "CHANGES_REQUESTED"],
  attest: ["PENDING_APPROVAL"],
  book: ["APPROVED"],
  export: ["BOOKED"],
  done: ["EXPORTED"],
};

// Sortable columns as database orders. Every one ends in `id` so paging never repeats or skips a row on ties.
const EXPENSE_ORDER: Record<string, (dir: SortDir) => Prisma.ExpenseOrderByWithRelationInput[]> = {
  date: (d) => [{ purchaseDate: d }, { id: d }],
  title: (d) => [{ title: d }, { id: d }],
  reference: (d) => [{ reference: d }, { id: d }],
  amount: (d) => [{ grossAmount: d }, { id: d }],
  status: (d) => [{ status: d }, { id: d }],
  paymentType: (d) => [{ paymentType: d }, { id: d }],
  submitter: (d) => [{ submitter: { name: d } }, { id: d }],
};

// Newest first, the order references are handed out in. Not unique (a seeded batch shares a timestamp), hence the tiebreaker.
const EXPENSE_DEFAULT_ORDER: Prisma.ExpenseOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  { id: "desc" },
];

async function listScopeWhere(
  scope: ExpenseListScope,
  viewer: Viewer,
): Promise<Prisma.ExpenseWhereInput> {
  switch (scope.kind) {
    case "all":
      return {};
    case "mine":
      return { submitterId: viewer.id };
    case "attestable":
      return attestScopeWhere(viewer, { ownUnits: true });
  }
}

function listQueryWhere(q: ListQuery): Prisma.ExpenseWhereInput[] {
  const and: Prisma.ExpenseWhereInput[] = [];

  // The tab is a stage (one or more statuses); the dropdown's picks are not read here.
  const statuses = STATUS_TAB[q.tab];
  if (statuses?.length) and.push({ status: { in: statuses } });

  const date = dateRangeFilter(q, { dateOnly: true });
  if (date) and.push({ purchaseDate: date });

  // Searchable columns asked of the database, case-insensitive.
  if (q.q) {
    and.push({
      OR: [
        { title: { contains: q.q, mode: "insensitive" } },
        { reference: { contains: q.q, mode: "insensitive" } },
        { submitter: { name: { contains: q.q, mode: "insensitive" } } },
      ],
    });
  }

  return and;
}

/**
 * One page of a list screen, and how many rows are behind it, with filter, sort and cut in the database.
 * The default orderings and filter columns are indexed (Expense in schema.prisma); `title` and
 * `paymentType` are not. The search is `ILIKE '%q%'`, which no btree answers, so it reads the table
 * (pg_trgm would fix that).
 */
export async function getExpensePage(
  viewer: Viewer,
  scope: ExpenseListScope,
  q: ListQuery,
  /** The räkenskapsår, by purchase date. */
  { during }: { during?: During } = {},
): Promise<RowPage<Expense>> {
  // Both always applied: what this screen is about, and what the viewer may see at all. Neither may reach past the scope.
  const where: Prisma.ExpenseWhereInput = {
    AND: [
      expenseScopeWhere(await expenseScopeOf(viewer)),
      await listScopeWhere(scope, viewer),
      ...listQueryWhere(q),
      ...(during ? [{ purchaseDate: during }] : []),
    ],
  };

  const { skip, take } = pageBounds(q);
  const order = EXPENSE_ORDER[q.sort];

  const [rows, total, ctx, prefixes] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: order ? order(q.dir) : EXPENSE_DEFAULT_ORDER,
      skip,
      take,
      include: summaryInclude,
    }),
    prisma.expense.count({ where }),
    attestCtx(viewer),
    getPrefixes(),
  ]);

  return {
    rows: rows.map((e) => {
      const mapped = mapSummary(e, prefixes);
      annotateAttest(e, mapped, ctx);
      return mapped;
    }),
    total,
  };
}

/**
 * Everything that could be waiting on this viewer, and their own most recent utlägg (the dashboard).
 * Only statuses that can wait are fetched; the filter is wider than `queueActionFor`, which still decides.
 * Attest is narrower on purpose: only the viewer's own result units' utlägg, as for the nav badge.
 */
export async function getDashboardExpenses(
  viewer: Viewer,
  minePreview: number,
  /** The räkenskapsår, by purchase date, for both halves. */
  { during }: { during?: During } = {},
): Promise<{ queueCandidates: Expense[]; mine: Expense[] }> {
  const scope = expenseScopeWhere(await expenseScopeOf(viewer));
  const inYear: Prisma.ExpenseWhereInput = during ? { purchaseDate: during } : {};

  const waitingOnSubmitter: Prisma.ExpenseWhereInput = {
    submitterId: viewer.id,
    status: { in: ["CHANGES_REQUESTED", "DRAFT"] },
  };

  const candidates: Prisma.ExpenseWhereInput[] = [waitingOnSubmitter];
  if (hasAttestRole(viewer.capabilities)) {
    candidates.push({
      AND: [
        await attestScopeWhere(viewer, { ownUnits: true }),
        { status: { in: ["PENDING_APPROVAL"] } },
      ],
    });
  }
  if (canBookkeep(viewer.capabilities)) {
    candidates.push({ status: { in: ["APPROVED", "BOOKED"] } });
  }

  const [queueRows, mineRows, ctx, prefixes] = await Promise.all([
    prisma.expense.findMany({
      where: { AND: [scope, inYear, { OR: candidates }] },
      orderBy: EXPENSE_DEFAULT_ORDER,
      include: summaryInclude,
    }),
    prisma.expense.findMany({
      where: { submitterId: viewer.id, ...inYear },
      orderBy: [{ purchaseDate: "desc" }, { id: "desc" }],
      take: minePreview,
      include: summaryInclude,
    }),
    attestCtx(viewer),
    getPrefixes(),
  ]);

  const map = (rows: SummaryRow[]) =>
    rows.map((e) => {
      const mapped = mapSummary(e, prefixes);
      annotateAttest(e, mapped, ctx);
      return mapped;
    });

  return { queueCandidates: map(queueRows), mine: map(mineRows) };
}

export async function getExpense(id: string, viewer?: Viewer): Promise<Expense | null> {
  // Scope goes into the lookup: an out-of-scope expense is simply not found (notFound page, 404 API).
  const scopeWhere = viewer ? expenseScopeWhere(await expenseScopeOf(viewer)) : {};
  const e = await prisma.expense.findFirst({
    where: { AND: [{ id }, scopeWhere] },
    include: {
      ...summaryInclude,
      // Several events in one transaction share a timestamp.
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
      ? mapVerification(
          e.verification,
          e.verification.lines.map((l) => ({
            id: l.id,
            account: l.account,
            accountName: l.accountName,
            description: l.description ?? undefined,
            costCenterCode: l.costCenter?.code,
            project: l.project ?? undefined,
            debit: ore(l.debit),
            credit: ore(l.credit),
          })),
        )
      : undefined,
    revisions: e.events.map((ev) => ({
      id: ev.id,
      actor: ev.actor?.name ?? "System",
      actorId: ev.actor?.id,
      action: ev.type,
      comment: ev.comment ?? undefined,
      recipients: ev.type === "REMINDER_SENT" ? reminderRecipients(ev.diff) : undefined,
      correction: ev.type === "CORRECTED" ? (correctionOf(ev.diff) ?? undefined) : undefined,
      date: ev.createdAt.toISOString(),
    })),
  };
  if (viewer) annotateAttest(e, mapped, await attestCtx(viewer));
  return mapped;
}

/** One member's utlägg from the last fifteen months, as little of each as the duplicate check needs (lib/domain/duplicates.ts). */
export async function getExpenseFingerprints(submitterId: string): Promise<ExpenseFingerprint[]> {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 15);
  const rows = await prisma.expense.findMany({
    where: {
      submitterId,
      grossAmount: { not: null },
      purchaseDate: { gte: since },
    },
    select: { id: true, reference: true, title: true, grossAmount: true, purchaseDate: true },
    orderBy: [{ purchaseDate: "desc" }, { id: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference ?? undefined,
    title: r.title,
    grossAmount: ore(r.grossAmount),
    purchaseDate: isoDate(r.purchaseDate!),
  }));
}
