// Utlägg: the list every screen renders, and the full single one behind the
// detail page. Also the place a viewer's scope is applied: which expenses they
// may see at all, and which allocations they may attest.
import "server-only";

import { prisma } from "@/lib/server/db";
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
import {
  canAccessBookkeeping,
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
// timeline and no voucher lines, since those are loaded only on the detail page).
const summaryInclude = {
  submitter: true,
  allocations: {
    include: { costCenter: true, approvedBy: true },
  },
  // take: 1 makes the tiebreaker matter twice over. Two receipts stored in the
  // same instant would otherwise pick an arbitrary one as "newest". The
  // annotation keeps this array mutable despite the `as const` below, which is
  // what Prisma's argument types require.
  receipts: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }] as Prisma.ReceiptOrderByWithRelationInput[],
    take: 1,
    select: { id: true, mimeType: true },
  },
  verification: { include: { createdBy: true } },
} as const;

type SummaryRow = Awaited<
  ReturnType<typeof prisma.expense.findFirstOrThrow<{ include: typeof summaryInclude }>>
>;

function fortnoxLabel(v: { fortnoxSeries: string | null; fortnoxNumber: number | null }): string | undefined {
  return v.fortnoxSeries && v.fortnoxNumber != null ? `${v.fortnoxSeries}-${v.fortnoxNumber}` : undefined;
}

// One shape for the booked voucher, whether or not its rows were loaded.
//
// A list wants the heading: the date, who booked it, the Fortnox number, and
// has no use for the rows; the detail page wants both. That was two copies of
// the same object literal, and the detail one worked by building the version
// without rows and then discarding it whole to build it again with them.
// `lines` is what actually differs, so it is the argument.
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
    // Absent until the utlägg is submitted for attest. See reference in
    // schema.prisma. The interface says so rather than inventing a placeholder.
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
    receiptId: e.receipts[0]?.id,
    receiptMimeType: e.receipts[0]?.mimeType,
    // Absent, not empty, for anything that is not a milersättning. See the
    // field on the Expense interface. The readings live on the utlägg itself,
    // so this costs no join.
    mileage:
      e.paymentType === "MILEAGE"
        ? {
            odometerStart: e.odometerStart == null ? null : Number(e.odometerStart),
            odometerEnd: e.odometerEnd == null ? null : Number(e.odometerEnd),
            km: journeyKm(
              e.odometerStart == null ? null : Number(e.odometerStart),
              e.odometerEnd == null ? null : Number(e.odometerEnd),
            ),
            orePerKm: e.mileageOrePerKm,
          }
        : undefined,
    submitterHasPayout: Boolean(
      e.submitter.bankClearingNumber && e.submitter.bankAccountNumber,
    ),
    verification: e.verification ? mapVerification(e.verification) : undefined,
    revisions: [],
  };
}

export type { Viewer };

// Per-request attest context: what the viewer may do and what they answer for,
// resolved once, plus the prefix table used to place each allocation in a result
// unit.
//
// Both roles and capabilities, because the attest rule reads both: ADMIN is a
// capability, the vice-skattmästare and resultatansvarig clauses are roles.
// See canAttestAllocation in lib/domain/permissions.ts.
type AttestCtx = {
  viewerId: string;
  viewerRoles: Role[];
  viewerCapabilities: Capability[];
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
    viewerCapabilities: viewer.capabilities,
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
      actorCapabilities: ctx.viewerCapabilities,
      actorRoles: ctx.viewerRoles,
      actorIsSubmitter,
      actorOwnedResultUnits: ctx.ownedResultUnits,
      submitterRoles,
      allocationResultUnit: resultUnitById.get(a.id) ?? null,
    });
  }
  mapped.canReturn = canReturnApproved(ctx.viewerCapabilities);
}

// ── The list screens ──────────────────────────────────────────────

/**
 * Which slice of the section's utlägg a list screen is about, before anything
 * the reader has typed. This is the page's own subject: "the attest queue",
 * "what bookkeeping still has to book", and it is the page that knows it.
 */
export type ExpenseListScope =
  | { kind: "all" }
  /** Only the viewer's own. */
  | { kind: "mine" }
  /** What the viewer may attest. See attest-scope.ts. */
  | { kind: "attestable" }
  /** The whole section's attest queue, for a bookkeeping role looking wider. */
  | { kind: "attestChain" }
  /** Signed and beyond: what bookkeeping works on. */
  | { kind: "signed" };

// The status tabs, as the database spells them, which is now the same way the
// interface spells them, since REJECTED was migrated away. A tab is one status
// unless the page's question genuinely covers several.
const STATUS_TAB: Record<string, DbExpenseStatus[]> = {
  DRAFT: ["DRAFT"],
  PENDING_MATCH: ["PENDING_MATCH"],
  PENDING_APPROVAL: ["PENDING_APPROVAL"],
  CHANGES_REQUESTED: ["CHANGES_REQUESTED"],
  APPROVED: ["APPROVED"],
  BOOKED: ["BOOKED"],
  EXPORTED: ["EXPORTED"],
  // The attest page names its two tabs after the question it asks rather than
  // after a status ("waiting on someone" and "signed") and the second covers
  // three. Distinct from the names above, so one table serves every list.
  PENDING: ["PENDING_APPROVAL"],
  ATTESTED: ["APPROVED", "BOOKED", "EXPORTED"],
};

const SIGNED: DbExpenseStatus[] = ["APPROVED", "BOOKED", "EXPORTED"];
const ATTEST_CHAIN: DbExpenseStatus[] = ["PENDING_APPROVAL", ...SIGNED];

// What each sortable column on the list is, as an order the database can take.
// Every one ends in `id`: a page is a window onto an ordering, so an ordering
// with ties is a window that can show the same row twice and skip another as
// the reader pages through it. The client offers exactly these keys.
const EXPENSE_ORDER: Record<string, (dir: SortDir) => Prisma.ExpenseOrderByWithRelationInput[]> = {
  date: (d) => [{ purchaseDate: d }, { id: d }],
  title: (d) => [{ title: d }, { id: d }],
  reference: (d) => [{ reference: d }, { id: d }],
  amount: (d) => [{ grossAmount: d }, { id: d }],
  status: (d) => [{ status: d }, { id: d }],
  paymentType: (d) => [{ paymentType: d }, { id: d }],
  submitter: (d) => [{ submitter: { name: d } }, { id: d }],
};

// Newest first, and the order references are handed out in. Not unique: a
// seeded batch shares a timestamp, so it carries a tiebreaker too.
const EXPENSE_DEFAULT_ORDER: Prisma.ExpenseOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  { id: "desc" },
];

/** The page's own subject, as a filter. */
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
      return attestScopeWhere(viewer);
    case "attestChain":
      return { status: { in: ATTEST_CHAIN } };
    case "signed":
      return { status: { in: SIGNED } };
  }
}

/** What the reader has typed and picked, as a filter. */
function listQueryWhere(q: ListQuery): Prisma.ExpenseWhereInput[] {
  const and: Prisma.ExpenseWhereInput[] = [];

  // The tab is one status; the dropdown is any number of them, OR-ed, and
  // picking none narrows nothing. A list uses one or the other, never both.
  const statuses = q.picks.length
    ? q.picks.flatMap((p) => STATUS_TAB[p] ?? [])
    : STATUS_TAB[q.tab];
  if (statuses?.length) and.push({ status: { in: statuses } });

  const date = dateRangeFilter(q, { dateOnly: true });
  if (date) and.push({ purchaseDate: date });

  // The columns the table marks searchable, asked of the database instead of
  // of an array. Case-insensitive, because nobody types a reference in caps.
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
 * One page of a list screen, and how many rows are behind it.
 *
 * Replaces loading every utlägg the viewer may see and letting the browser cut
 * it down to twenty-five. The filtering, the sorting and the cut all happen in
 * the database.
 *
 * What that is worth depends on there being an index behind the ordering, which
 * for a while there was not. The work moved to Postgres and Postgres sorted the
 * whole matching set for every page. The orderings this issues by default, and
 * the columns it filters on, are indexed now (see Expense in schema.prisma);
 * `title` and `paymentType` are deliberately not, so choosing one of those sorts
 * is a sort. On a section's table that is a few milliseconds, which is the
 * reason it is allowed to be.
 *
 * The search is a different matter and no index helps it: `contains` is
 * `ILIKE '%q%'`, which no btree can answer, so it reads the table. Same
 * conclusion at this size, and the same thing to revisit first if it ever stops
 * being true. A trigram index is the answer, and it needs the pg_trgm
 * extension.
 */
export async function getExpensePage(
  viewer: Viewer,
  scope: ExpenseListScope,
  q: ListQuery,
): Promise<RowPage<Expense>> {
  // Two filters, both always applied: what this screen is about, and what the
  // viewer is allowed to see at all. The second is not the first's business.
  // an attest queue is narrower than "everything you may see", and a
  // bookkeeping list is wider, but neither may reach past the scope.
  const where: Prisma.ExpenseWhereInput = {
    AND: [
      expenseScopeWhere(await expenseScopeOf(viewer)),
      await listScopeWhere(scope, viewer),
      ...listQueryWhere(q),
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
 * Everything that could possibly be waiting on this viewer, and their own most
 * recent utlägg, the two things the dashboard is made of.
 *
 * The queue is derived by `buildQueue` (domain/queue.ts), which asks each utlägg
 * whether it is waiting on this person. It used to be asked of every utlägg in
 * the section; the answer is only ever yes for a handful of statuses, so those
 * are what is fetched. An exported utlägg from three years ago cannot be
 * waiting on anybody, and there is no reason to read it to find that out.
 *
 * The filter is deliberately wider than `queueActionFor`. It is a shortlist,
 * not a second copy of the rule. That function still decides, unchanged, and if
 * the two ever disagree the worst case is a row fetched and then dropped.
 */
export async function getDashboardExpenses(
  viewer: Viewer,
  minePreview: number,
): Promise<{ queueCandidates: Expense[]; mine: Expense[] }> {
  const scope = expenseScopeWhere(await expenseScopeOf(viewer));

  // Waiting on you as the person who sent it in.
  const waitingOnSubmitter: Prisma.ExpenseWhereInput = {
    submitterId: viewer.id,
    status: { in: ["CHANGES_REQUESTED", "DRAFT", "PENDING_MATCH"] },
  };

  const candidates: Prisma.ExpenseWhereInput[] = [waitingOnSubmitter];
  if (hasAttestRole(viewer.capabilities)) {
    candidates.push({
      AND: [await attestScopeWhere(viewer), { status: { in: ["PENDING_APPROVAL"] } }],
    });
  }
  if (canAccessBookkeeping(viewer.capabilities)) {
    candidates.push({ status: { in: ["APPROVED", "BOOKED"] } });
  }

  const [queueRows, mineRows, ctx, prefixes] = await Promise.all([
    prisma.expense.findMany({
      where: { AND: [scope, { OR: candidates }] },
      orderBy: EXPENSE_DEFAULT_ORDER,
      include: summaryInclude,
    }),
    // The dashboard shows a handful, so it asks for a handful.
    prisma.expense.findMany({
      where: { submitterId: viewer.id },
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

// Full single expense for the detail page. Adds the event timeline and the
// verification's voucher lines on top of the summary shape.
export async function getExpense(
  id: string,
  viewer?: Viewer,
): Promise<Expense | null> {
  // The scope goes into the lookup rather than after it: an expense the viewer
  // may not see is simply not found, which is the answer both callers want
  // anyway (the page renders notFound, the API answers 404).
  const scopeWhere = viewer ? expenseScopeWhere(await expenseScopeOf(viewer)) : {};
  const e = await prisma.expense.findFirst({
    where: { AND: [{ id }, scopeWhere] },
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
      ? mapVerification(
          e.verification,
          e.verification.lines.map((l) => ({
            id: l.id,
            account: l.account,
            accountName: l.accountName,
            description: l.description ?? undefined,
            costCenterCode: l.costCenter?.code,
            debit: ore(l.debit),
            credit: ore(l.credit),
          })),
        )
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
