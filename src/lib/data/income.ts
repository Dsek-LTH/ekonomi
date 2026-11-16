// Income days and the fetches that brought them in. A batch is provenance; screens work day by day.
import "server-only";

import { oreToSEK } from "@/lib/domain/money";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/server/db";
import type { IncomeReportStatus, IncomeSource } from "@/lib/domain/types";
import { isoDay } from "@/lib/domain/date";
import { isLegacyReport } from "@/lib/income/legacy";
import { sourcesOf, type IncomeSourceSlug } from "@/lib/income/source-slug";
import { getPrefixes, resultUnitForCode } from "@/lib/server/result-units";
import { voucherBasis, type ManualVoucherRow } from "@/lib/income/manual-voucher";
import type { During } from "@/lib/server/fiscal-year";
import {
  dateRangeFilter,
  pageBounds,
  type ListQuery,
  type RowPage,
  type SortDir,
} from "./list-query";

// Money here is SEK, not öre (rendered by <Amount>; lib/domain/money.ts).
export interface IncomeLineRow {
  id: string;
  kind: "SALE" | "FEE";
  /** Whose sale. Null on a fee, and on a sale routing could not place. */
  resultUnitId: string | null;
  unitName: string | null;
  name: string;
  variant: string | null;
  account: string;
  accountName: string;
  costCenterId: string | null;
  costCenterCode: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  /** What the line adds to the clearing account: negative for a fee. */
  total: number;
  /** Matched no prefix and went to the reserv; nobody has placed it since. */
  unmatched: boolean;
}

export interface IncomeReportRow {
  id: string;
  source: IncomeSource;
  date: string;
  total: number;
  status: IncomeReportStatus;
  /** Booked before the per-day voucher: one verksamhet's day, or a day of Zettle fees. Read-only (lib/income/legacy.ts). */
  legacy: boolean;
  /** Every verksamhet with sales on the day, by name. On an old report, the one it was for. */
  unitNames: string[];
  costCenterCodes: string[];
  documentFilename: string | null;
  /** The Fortnox voucher, once exported, e.g. "IR-142". */
  voucherLabel: string | null;
  /** A voucher Fortnox already held for some of this source's money on this day at import, e.g. "IR-142". Shown as a warning. */
  existingVoucher: string | null;
  /** A report booked here that already holds some of this day's money. Unlike `existingVoucher`, it blocks booking. */
  duplicateOf: { id: string; voucherLabel: string | null } | null;
  batchId: string;
  importedAt: string;
  /** When the row last changed. Hung on the document URL so a corrected report is a new address (the draft document is browser-cached for five minutes). */
  updatedAt: string;
  /** Who wrote the kontering (konterade or wrote by hand). Neither may granska and bokföra it (lib/domain/review.ts). */
  bookedBy: string[];
  reviewedByName: string | null;
  reviewedAt: string | null;
  lines: IncomeLineRow[];
  /** A hand-written kontering, or null when the day books the rows its lines give (lib/income/manual-voucher.ts). */
  manual: {
    rows: {
      account: string;
      accountName: string;
      costCenterCode: string | null;
      project: string | null;
      description: string | null;
      debit: number;
      credit: number;
    }[];
    stale: boolean;
    byName: string | null;
    at: string | null;
  } | null;
}

// One include for every place a report row is loaded, so lists cannot drift.
const UNIT_NAME = { select: { name: true, income: { select: { properName: true } } } } as const;

const REPORT_INCLUDE = {
  resultUnit: UNIT_NAME,
  costCenter: { select: { code: true } },
  reviewedBy: { select: { name: true } },
  manualVoucherBy: { select: { name: true } },
  lines: {
    orderBy: { sortOrder: "asc" },
    include: { resultUnit: UNIT_NAME, costCenter: { select: { code: true } } },
  },
  verification: { select: { fortnoxSeries: true, fortnoxNumber: true, createdById: true } },
  duplicateOf: {
    select: {
      id: true,
      verification: { select: { fortnoxSeries: true, fortnoxNumber: true } },
    },
  },
} as const;

type LoadedReport = Prisma.IncomeReportGetPayload<{ include: typeof REPORT_INCLUDE }>;

const unitName = (u: { name: string; income: { properName: string | null } | null } | null) =>
  u ? (u.income?.properName ?? u.name) : null;

const label = (v: { fortnoxSeries: string | null; fortnoxNumber: number | null } | null) =>
  v?.fortnoxSeries && v.fortnoxNumber ? `${v.fortnoxSeries}-${v.fortnoxNumber}` : null;

const distinct = (xs: (string | null)[]) =>
  [...new Set(xs.filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b, "sv"));

function reportRow(r: LoadedReport): IncomeReportRow {
  const legacy = isLegacyReport(r);
  return {
    id: r.id,
    source: r.source,
    date: isoDay(r.date),
    total: oreToSEK(r.total),
    status: r.status,
    legacy,
    unitNames: legacy
      ? distinct([unitName(r.resultUnit)])
      : distinct(r.lines.map((l) => unitName(l.resultUnit))),
    costCenterCodes: legacy
      ? distinct([r.costCenter?.code ?? null])
      : distinct(r.lines.map((l) => l.costCenter?.code ?? null)),
    documentFilename: r.documentFilename,
    voucherLabel: label(r.verification),
    existingVoucher: r.existingVoucher,
    duplicateOf: r.duplicateOf && {
      id: r.duplicateOf.id,
      voucherLabel: label(r.duplicateOf.verification),
    },
    batchId: r.batchId,
    importedAt: r.createdAt.toISOString(),
    bookedBy: [
      ...new Set(
        [r.reviewedById, r.verification?.createdById, r.manualVoucherById].filter(
          (x): x is string => Boolean(x),
        ),
      ),
    ],
    reviewedByName: r.reviewedBy?.name ?? null,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
    // A day booked before the per-day voucher keeps its verksamhet on the report and its fees in a
    // report of their own; read onto the lines so old days draw like new ones.
    lines: r.lines.map((l) => ({
      id: l.id,
      kind: legacy && r.source === "ZETTLE_FEE" ? ("FEE" as const) : l.kind,
      resultUnitId: legacy ? r.resultUnitId : l.resultUnitId,
      unitName: legacy ? unitName(r.resultUnit) : unitName(l.resultUnit),
      name: l.name,
      variant: l.variant,
      account: l.account,
      accountName: l.accountName,
      costCenterId: l.costCenterId,
      costCenterCode: l.costCenter?.code ?? null,
      quantity: l.quantity,
      unitPrice: oreToSEK(l.unitPrice),
      discount: oreToSEK(l.discount),
      total: oreToSEK(l.total),
      unmatched: legacy ? false : l.unmatched,
    })),
    manual: manualOf(r),
  };
}

function manualOf(r: LoadedReport): IncomeReportRow["manual"] {
  const rows = r.manualVoucher as ManualVoucherRow[] | null;
  if (!rows) return null;
  return {
    rows: rows.map((m) => ({
      account: m.account,
      accountName: m.accountName,
      costCenterCode: m.costCenterCode,
      project: m.project,
      description: m.description,
      debit: oreToSEK(m.debit),
      credit: oreToSEK(m.credit),
    })),
    stale: r.manualVoucherBasis !== voucherBasis(r.lines, r.total),
    byName: r.manualVoucherBy?.name ?? null,
    at: r.manualVoucherAt?.toISOString() ?? null,
  };
}

/**
 * A verksamhet a mis-routed sale can be given to, and the accounts its product prefixes point at
 * (offered first, not imposed). The routing strips the prefix, so a reserv line never carried one.
 * See lib/income/lines.ts.
 */
export interface IncomeMoveTarget {
  resultUnitId: string;
  name: string;
  accounts: { account: string; accountName: string; prefixes: string[] }[];
  /** The unit's active cost centres whose code its result-unit prefix matches (lib/server/result-units.ts). */
  costCenterCodes: string[];
}

/** Every verksamhet still taking money in (inactive ones are dropped, as in lib/income/config.ts). */
export async function getIncomeMoveTargets(): Promise<IncomeMoveTarget[]> {
  const [units, accounts, prefixes, centres] = await Promise.all([
    prisma.resultUnitIncome.findMany({
      where: { active: true },
      select: {
        resultUnitId: true,
        properName: true,
        resultUnit: { select: { name: true } },
        prefixes: { select: { code: true, account: true }, orderBy: { code: "asc" } },
      },
    }),
    prisma.account.findMany({ select: { number: true, name: true } }),
    getPrefixes(),
    prisma.costCenter.findMany({
      where: { active: true },
      select: { code: true },
      orderBy: { code: "asc" },
    }),
  ]);
  const accountName = new Map(accounts.map((a) => [a.number, a.name]));
  const ownCodes = (resultUnitId: string) =>
    centres
      .filter((c) => resultUnitForCode(c.code, prefixes)?.resultUnitId === resultUnitId)
      .map((c) => c.code);

  return units
    .map((u) => {
      // One entry per distinct account with the prefixes routing to it: "3011 - öl, öl2".
      const byAccount = new Map<string, string[]>();
      for (const p of u.prefixes) {
        const codes = byAccount.get(p.account);
        if (codes) codes.push(p.code);
        else byAccount.set(p.account, [p.code]);
      }
      return {
        resultUnitId: u.resultUnitId,
        name: u.properName ?? u.resultUnit.name,
        accounts: [...byAccount.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([account, prefixes]) => ({
            account,
            accountName: accountName.get(account) ?? "",
            prefixes,
          })),
        costCenterCodes: ownCodes(u.resultUnitId),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

/** Intäkter's stage tabs (app/(app)/income/tabs.ts) as statuses. "all" is absent and narrows nothing. */
const INCOME_TAB_STATUS: Record<string, IncomeReportStatus> = {
  book: "DRAFT",
  export: "BOOKED",
  done: "EXPORTED",
};

// Sortable columns as database orders, each ending in `id` so paging never repeats or skips a row.
const INCOME_ORDER: Record<string, (d: SortDir) => Prisma.IncomeReportOrderByWithRelationInput[]> =
  {
    date: (d) => [{ date: d }, { id: d }],
    total: (d) => [{ total: d }, { id: d }],
  };
const INCOME_DEFAULT_ORDER = INCOME_ORDER.date("desc");

function incomeListWhere(q: ListQuery): Prisma.IncomeReportWhereInput[] {
  const and: Prisma.IncomeReportWhereInput[] = [];
  const status = INCOME_TAB_STATUS[q.tab];
  if (status) and.push({ status });
  const date = dateRangeFilter(q, { dateOnly: true });
  if (date) and.push({ date });
  // The verksamhet and cost centre columns. A day made since the per-day voucher has them on its
  // lines, an old one on the report itself.
  if (q.q) {
    const has = { contains: q.q, mode: "insensitive" as const };
    const unit = { OR: [{ name: has }, { income: { properName: has } }] };
    and.push({
      OR: [
        { resultUnit: unit },
        { costCenter: { code: has } },
        { lines: { some: { resultUnit: unit } } },
        { lines: { some: { costCenter: { code: has } } } },
      ],
    });
  }
  return and;
}

/** One page of an Intäkter list, Zettle or Swish, with tab, search, dates, year and sort in the database. */
export async function getIncomePage(
  slug: IncomeSourceSlug,
  q: ListQuery,
  { during }: { during?: During } = {},
): Promise<RowPage<IncomeReportRow>> {
  const where: Prisma.IncomeReportWhereInput = {
    AND: [
      { source: { in: sourcesOf(slug) } },
      ...incomeListWhere(q),
      ...(during ? [{ date: during }] : []),
    ],
  };
  const order = INCOME_ORDER[q.sort];
  const [rows, total] = await Promise.all([
    prisma.incomeReport.findMany({
      where,
      orderBy: order ? order(q.dir) : INCOME_DEFAULT_ORDER,
      ...pageBounds(q),
      include: REPORT_INCLUDE,
    }),
    prisma.incomeReport.count({ where }),
  ]);
  return { rows: rows.map(reportRow), total };
}

/**
 * Every day still to kontera or export, whatever page or year is showing: what "Kontera alla" and
 * "Exportera alla" act on. Unfinished work only, so this does not grow with the years.
 */
export async function getIncomeBacklog(slug: IncomeSourceSlug): Promise<IncomeReportRow[]> {
  const reports = await prisma.incomeReport.findMany({
    where: { source: { in: sourcesOf(slug) }, status: { in: ["DRAFT", "BOOKED"] } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    include: REPORT_INCLUDE,
  });
  return reports.map(reportRow);
}

/** Whether any day has been brought in for this source at all, to tell a first visit from an empty filter. */
export async function hasIncomeReports(slug: IncomeSourceSlug): Promise<boolean> {
  const one = await prisma.incomeReport.findFirst({
    where: { source: { in: sourcesOf(slug) } },
    select: { id: true },
  });
  return one !== null;
}

export interface IncomeVoucherRow {
  account: string;
  accountName: string;
  costCenterCode: string | null;
  project: string | null;
  description: string | null;
  debit: number;
  credit: number;
}

export interface IncomeReportDetail {
  report: IncomeReportRow;
  voucher: IncomeVoucherRow[] | null;
}

export async function getIncomeReport(id: string): Promise<IncomeReportDetail | null> {
  const r = await prisma.incomeReport.findUnique({
    where: { id },
    include: {
      ...REPORT_INCLUDE,
      verification: {
        select: {
          fortnoxSeries: true,
          fortnoxNumber: true,
          createdById: true,
          lines: {
            orderBy: { sortOrder: "asc" },
            include: { costCenter: { select: { code: true } } },
          },
        },
      },
    },
  });
  if (!r) return null;
  return {
    report: reportRow(r),
    voucher:
      r.verification?.lines.map((l) => ({
        account: l.account,
        accountName: l.accountName,
        costCenterCode: l.costCenter?.code ?? null,
        project: l.project,
        description: l.description,
        debit: oreToSEK(l.debit),
        credit: oreToSEK(l.credit),
      })) ?? null,
  };
}
