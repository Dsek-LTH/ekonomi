// Reading a financial year for the bokslut: every voucher in the ledger, what
// underlag the app holds for each, and where each stands in the review.
//
// Every voucher, not only the ones the app made. Bank fees, Swish settlements
// and anything booked by hand in Fortnox are in the ledger too, and those are
// exactly what a revisor asks about. Which of them the app knows is worked out
// in lib/closing/evidence.ts.
//
// Filtered, sorted and paged here rather than in the database, unlike the
// other lists. Which tab a voucher falls under, and where it stands in the
// review, both depend on joins the schema has no relation for (the ledger is
// Fortnox's mirror and cannot point at the app's records), so the database
// cannot filter on them. A year is a few thousand vouchers, which is small
// enough to hold whole for one request.
import "server-only";

import {
  evidenceFor,
  indexAppVouchers,
  voucherKey,
  type AppVoucher,
  type VoucherEvidence,
} from "@/lib/closing/evidence";
import { voucherFingerprint } from "@/lib/closing/fingerprint";
import { flagVouchers, type VoucherFlag } from "@/lib/closing/flags";
import {
  REVIEW_PASSES,
  currentReview,
  isSettled,
  type ReviewPass,
  type ReviewPick,
  type ReviewRecord,
  type ReviewState,
} from "@/lib/closing/review";
import { oreToSEK } from "@/lib/domain/money";
import { pageBounds, type ListQuery, type RowPage } from "@/lib/data/list-query";
import { prisma } from "@/lib/server/db";
import { bookedByOf } from "@/lib/server/review";

export interface ClosingYear {
  /** Fortnox's financial-year id, which is what the URL carries. */
  id: number;
  /** The calendar year it starts in, which is what people call it. */
  year: number;
  fromDate: string;
  toDate: string;
  lastSyncAt: string | null;
  vouchers: number;
}

// Money here is SEK, not öre, as everywhere a figure crosses into the browser.
export interface ClosingVoucher {
  key: string;
  date: string;
  description: string;
  /** The voucher's total: the sum of its debit rows. */
  amount: number;
  /** What the review of this voucher has to be a review of. */
  contentHash: string;
  evidence: VoucherEvidence;
  review: Record<ReviewPass, ReviewState>;
  comments: number;
  flags: VoucherFlag[];
}

export interface ClosingVoucherRow {
  id: string;
  account: string;
  accountName: string;
  costCenter: string | null;
  project: string | null;
  text: string | null;
  debit: number;
  credit: number;
}

export interface ClosingComment {
  id: string;
  author: string | null;
  body: string;
  createdAt: string;
  /** Written about an earlier version of the voucher than the one there now. */
  earlierVersion: boolean;
}

export interface ClosingVoucherDetail extends ClosingVoucher {
  rows: ClosingVoucherRow[];
  /** Every review in both passes, newest first. */
  history: (ReviewRecord & { current: boolean })[];
  thread: ClosingComment[];
}

export interface ClosingProgress {
  total: number;
  settled: Record<ReviewPass, number>;
  questions: Record<ReviewPass, number>;
  /** Reviews of vouchers that are no longer in the ledger. */
  orphaned: number;
}

/** The tabs of the voucher list. "all" first, the rest by evidence. */
export const CLOSING_TABS = ["all", "expense", "income", "none", "disagrees"] as const;
export type ClosingTab = (typeof CLOSING_TABS)[number];

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function toYear(
  y: { id: number; fromDate: Date; toDate: Date; lastSyncAt: Date | null },
  vouchers: number,
): ClosingYear {
  return {
    id: y.id,
    year: y.fromDate.getUTCFullYear(),
    fromDate: isoDate(y.fromDate),
    toDate: isoDate(y.toDate),
    lastSyncAt: y.lastSyncAt?.toISOString() ?? null,
    vouchers,
  };
}

export async function getClosingYear(id: number): Promise<ClosingYear | null> {
  const [y, vouchers] = await Promise.all([
    prisma.fortnoxFinancialYear.findUnique({ where: { id } }),
    prisma.ledgerVoucher.count({ where: { financialYear: id } }),
  ]);
  return y ? toYear(y, vouchers) : null;
}

/**
 * Fill in the fingerprint on vouchers synced before it existed.
 *
 * Once per year at most: the next sync writes it with everything else, and
 * until then the first read does it here. Computed from the stored rows in the
 * same shape the sync computes it from, so the two agree.
 */
async function backfillFingerprints(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const vouchers = await prisma.ledgerVoucher.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      date: true,
      description: true,
      rows: {
        select: { account: true, costCenterCode: true, text: true, debit: true, credit: true },
      },
    },
  });
  const hashes = new Map(
    vouchers.map((v) => [
      v.id,
      voucherFingerprint({ date: isoDate(v.date), description: v.description, rows: v.rows }),
    ]),
  );
  await prisma.$transaction(
    [...hashes].map(([id, contentHash]) =>
      prisma.ledgerVoucher.update({ where: { id }, data: { contentHash } }),
    ),
  );
  return hashes;
}

/**
 * The app's exported vouchers that can belong to this year.
 *
 * By the Fortnox year the export recorded. An export resolved by hand after an
 * uncertain outcome records no year (see the export resolve route), so those
 * are taken by their date instead.
 */
async function appVouchersFor(year: ClosingYear): Promise<AppVoucher[]> {
  const rows = await prisma.verification.findMany({
    where: {
      fortnoxSeries: { not: null },
      fortnoxNumber: { not: null },
      OR: [
        { fortnoxYear: year.id },
        {
          fortnoxYear: null,
          date: { gte: new Date(year.fromDate), lte: new Date(year.toDate) },
        },
      ],
    },
    select: {
      fortnoxSeries: true,
      fortnoxNumber: true,
      lines: { select: { debit: true } },
      expense: {
        select: {
          id: true,
          reference: true,
          title: true,
          deadlineWaivedAt: true,
          _count: { select: { receipts: true } },
          // Who sent it to Fortnox, to hold against who konterade it.
          events: {
            where: { type: "EXPORTED" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { actorId: true },
          },
        },
      },
      incomeReport: { select: { id: true, date: true } },
    },
  });

  const expenseIds = rows.flatMap((v) => (v.expense ? [v.expense.id] : []));
  const bookedBy = await bookedByOf(expenseIds);

  return rows.flatMap((v): AppVoucher[] => {
    let source: AppVoucher["source"] | null = null;
    if (v.expense) {
      const exporter = v.expense.events[0]?.actorId;
      source = {
        kind: "expense",
        id: v.expense.id,
        reference: v.expense.reference,
        title: v.expense.title,
        receipts: v.expense._count.receipts,
        deadlineWaived: v.expense.deadlineWaivedAt !== null,
        ownBooking: !!exporter && (bookedBy.get(v.expense.id) ?? []).includes(exporter),
      };
    } else if (v.incomeReport) {
      source = { kind: "income", id: v.incomeReport.id, date: isoDate(v.incomeReport.date) };
    }
    if (!source) return [];
    return [
      {
        series: v.fortnoxSeries!.toUpperCase(),
        number: v.fortnoxNumber!,
        debit: v.lines.reduce((sum, l) => sum + l.debit, 0),
        source,
      },
    ];
  });
}

/** Every review in the year, by voucher key. */
async function reviewsFor(yearId: number): Promise<Map<string, ReviewRecord[]>> {
  const rows = await prisma.voucherReview.findMany({
    where: { financialYear: yearId },
    orderBy: { reviewedAt: "desc" },
    select: {
      series: true,
      number: true,
      pass: true,
      status: true,
      contentHash: true,
      reviewedAt: true,
      reviewedBy: { select: { name: true } },
    },
  });
  const byKey = new Map<string, ReviewRecord[]>();
  for (const r of rows) {
    const key = voucherKey(r.series.toUpperCase(), r.number);
    const list = byKey.get(key) ?? [];
    list.push({
      pass: r.pass,
      status: r.status,
      contentHash: r.contentHash,
      reviewedAt: r.reviewedAt.toISOString(),
      reviewedBy: r.reviewedBy?.name ?? null,
    });
    byKey.set(key, list);
  }
  return byKey;
}

async function commentCountsFor(yearId: number): Promise<Map<string, number>> {
  const rows = await prisma.voucherComment.groupBy({
    by: ["series", "number"],
    where: { financialYear: yearId },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [voucherKey(r.series.toUpperCase(), r.number), r._count._all]));
}

/** Every voucher in the year with its underlag and its review, in ledger order. */
async function yearVouchers(
  year: ClosingYear,
): Promise<{ vouchers: ClosingVoucher[]; orphaned: number }> {
  const [ledger, totals, app, reviews, comments] = await Promise.all([
    prisma.ledgerVoucher.findMany({
      where: { financialYear: year.id },
      select: {
        id: true,
        series: true,
        number: true,
        date: true,
        description: true,
        contentHash: true,
      },
      orderBy: [{ series: "asc" }, { number: "asc" }],
    }),
    prisma.ledgerRow.groupBy({
      by: ["voucherId"],
      where: { financialYear: year.id },
      _sum: { debit: true },
    }),
    appVouchersFor(year),
    reviewsFor(year.id),
    commentCountsFor(year.id),
  ]);
  const filled = await backfillFingerprints(
    ledger.filter((v) => v.contentHash === null).map((v) => v.id),
  );
  const debitOf = new Map(totals.map((t) => [t.voucherId, t._sum.debit ?? 0]));
  const index = indexAppVouchers(app);

  const base = ledger.map((v) => {
    const debit = debitOf.get(v.id) ?? 0;
    const series = v.series.toUpperCase();
    return {
      key: voucherKey(series, v.number),
      date: isoDate(v.date),
      description: v.description,
      debit,
      contentHash: v.contentHash ?? filled.get(v.id)!,
      evidence: evidenceFor({ series, number: v.number, debit }, index),
    };
  });
  const flags = flagVouchers(
    base.map((v) => ({ ...v, amount: v.debit })),
    year,
  );

  const vouchers = base.map(({ debit, ...v }): ClosingVoucher => {
    const records = reviews.get(v.key) ?? [];
    return {
      ...v,
      amount: oreToSEK(debit),
      review: {
        PREPARER: currentReview(records, "PREPARER", v.contentHash),
        AUDITOR: currentReview(records, "AUDITOR", v.contentHash),
      },
      comments: comments.get(v.key) ?? 0,
      flags: flags.get(v.key) ?? [],
    };
  });

  const present = new Set(vouchers.map((v) => v.key));
  const orphaned = [...reviews.keys()].filter((k) => !present.has(k)).length;
  return { vouchers, orphaned };
}

const inTab = (tab: ClosingTab) => (v: ClosingVoucher) =>
  tab === "all"
    ? true
    : tab === "disagrees"
      ? v.evidence.kind !== "none" && !v.evidence.agrees
      : v.evidence.kind === tab;

/** Which review pick a voucher's standing in a pass answers to. */
function reviewPick(s: ReviewState): ReviewPick {
  if (s.state === "unreviewed") return "unreviewed";
  if (s.state === "changed") return "changed";
  return s.review.status;
}

function matchesSearch(v: ClosingVoucher, q: string): boolean {
  const needle = q.toLowerCase();
  const e = v.evidence;
  const haystack = [
    v.key,
    v.description,
    e.kind === "expense" ? `${e.reference ?? ""} ${e.title}` : "",
  ];
  return haystack.some((s) => s.toLowerCase().includes(needle));
}

// "A-2" before "A-10": by series, then by number, which is the ledger's order
// and the default.
const byNumber = (a: ClosingVoucher, b: ClosingVoucher) =>
  a.key.localeCompare(b.key, "sv", { numeric: true });

const SORTS: Record<string, (a: ClosingVoucher, b: ClosingVoucher) => number> = {
  number: byNumber,
  date: (a, b) => a.date.localeCompare(b.date) || byNumber(a, b),
  amount: (a, b) => a.amount - b.amount || byNumber(a, b),
};

function progressOf(all: readonly ClosingVoucher[], orphaned: number): ClosingProgress {
  const progress: ClosingProgress = {
    total: all.length,
    settled: { PREPARER: 0, AUDITOR: 0 },
    questions: { PREPARER: 0, AUDITOR: 0 },
    orphaned,
  };
  for (const v of all) {
    for (const p of REVIEW_PASSES) {
      const s = v.review[p];
      if (isSettled(s)) progress.settled[p]++;
      if (s.state === "reviewed" && s.review.status === "QUESTION") progress.questions[p]++;
    }
  }
  return progress;
}

/** How far each pass of the review has got over the whole year. */
export async function getClosingProgress(year: ClosingYear): Promise<ClosingProgress> {
  const { vouchers, orphaned } = await yearVouchers(year);
  return progressOf(vouchers, orphaned);
}

export function parseClosingTab(tab: string): ClosingTab {
  return (CLOSING_TABS as readonly string[]).includes(tab) ? (tab as ClosingTab) : "all";
}

/**
 * One page of the year's vouchers, how many fall under each tab, and how far
 * the review has got.
 *
 * `pass` is the one the review filter asks about: the viewer's own, or the
 * revisorer's for somebody who reviews in neither.
 */
export async function getClosingVoucherPage(
  year: ClosingYear,
  q: ListQuery,
  pass: ReviewPass,
): Promise<{
  page: RowPage<ClosingVoucher>;
  counts: Record<ClosingTab, number>;
  progress: ClosingProgress;
}> {
  const { vouchers: all, orphaned } = await yearVouchers(year);
  const progress = progressOf(all, orphaned);

  // The two filters share `picks`, told apart by their prefix (see
  // SelectFilters in data-table.tsx). OR-ed within one, AND-ed across them.
  const reviewPicks = q.picks.flatMap((p) => (p.startsWith("review:") ? [p.slice(7)] : []));
  const flagPicks = q.picks.flatMap((p) => (p.startsWith("flag:") ? [p.slice(5)] : []));

  const narrowed = all.filter(
    (v) =>
      (!q.q || matchesSearch(v, q.q)) &&
      (!q.from || v.date >= q.from) &&
      (!q.to || v.date <= q.to) &&
      (!reviewPicks.length || reviewPicks.includes(reviewPick(v.review[pass]))) &&
      (!flagPicks.length || v.flags.some((f) => flagPicks.includes(f))),
  );
  const counts = Object.fromEntries(
    CLOSING_TABS.map((t) => [t, narrowed.filter(inTab(t)).length]),
  ) as Record<ClosingTab, number>;

  const rows = narrowed.filter(inTab(parseClosingTab(q.tab)));
  const sort = SORTS[q.sort] ?? byNumber;
  rows.sort((a, b) => (q.dir === "desc" && q.sort ? -sort(a, b) : sort(a, b)));

  const { skip, take } = pageBounds(q);
  return {
    page: { rows: rows.slice(skip, skip + take), total: rows.length },
    counts,
    progress,
  };
}

/** One voucher, its rows, its underlag, its reviews and its thread. */
export async function getClosingVoucher(
  year: ClosingYear,
  ref: { series: string; number: number },
): Promise<ClosingVoucherDetail | null> {
  const { vouchers } = await yearVouchers(year);
  const voucher = vouchers.find((v) => v.key === voucherKey(ref.series, ref.number));
  if (!voucher) return null;

  const where = {
    financialYear: year.id,
    series: { equals: ref.series, mode: "insensitive" as const },
    number: ref.number,
  };
  const [ledger, reviews, comments] = await Promise.all([
    prisma.ledgerVoucher.findFirst({ where, include: { rows: { orderBy: { id: "asc" } } } }),
    reviewsFor(year.id).then((m) => m.get(voucher.key) ?? []),
    prisma.voucherComment.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: { author: { select: { name: true } } },
    }),
  ]);
  if (!ledger) return null;

  // The review each pass currently stands on, if it stands on one.
  const isCurrent = (r: ReviewRecord) => {
    const s = voucher.review[r.pass];
    return s.state === "reviewed" && s.review.reviewedAt === r.reviewedAt;
  };
  return {
    ...voucher,
    rows: ledger.rows.map((r) => ({
      id: r.id,
      account: r.account,
      accountName: r.accountName,
      costCenter: r.costCenterCode
        ? [r.costCenterCode, r.costCenterName].filter(Boolean).join(" - ")
        : null,
      project: r.project,
      text: r.text,
      debit: oreToSEK(r.debit),
      credit: oreToSEK(r.credit),
    })),
    history: reviews.map((r) => ({ ...r, current: isCurrent(r) })),
    thread: comments.map((c) => ({
      id: c.id,
      author: c.author?.name ?? null,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
      earlierVersion: c.contentHash !== voucher.contentHash,
    })),
  };
}

/**
 * What a voucher says now, as its fingerprint, for a route about to record a
 * review or a comment against it. Null when the year has no such voucher.
 */
export async function voucherFingerprintNow(
  yearId: number,
  ref: { series: string; number: number },
): Promise<{ series: string; contentHash: string } | null> {
  const v = await prisma.ledgerVoucher.findFirst({
    where: {
      financialYear: yearId,
      series: { equals: ref.series, mode: "insensitive" },
      number: ref.number,
    },
    select: { id: true, series: true, contentHash: true },
  });
  if (!v) return null;
  const contentHash = v.contentHash ?? (await backfillFingerprints([v.id])).get(v.id)!;
  return { series: v.series, contentHash };
}
