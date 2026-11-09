// Reading income: the days, and the fetches that brought them in.
//
// Report-first. A batch is provenance, when someone pressed fetch, and the
// screens that work with takings work day by day, so the two report queries
// below are the ones that matter.
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

// Money here is SEK, not öre: these cross into the browser and are rendered
// by <Amount>, and the repo's rule is that the database keeps öre and the
// interface shows kronor (lib/domain/money.ts).
export interface IncomeLineRow {
  id: string;
  kind: "SALE" | "FEE";
  /** Whose sale. Null on a fee, and on a sale routing could not place. */
  resultUnitId: string | null;
  /** The verksamhet as the documents name it. */
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
  /** What the day moves the clearing account by: sales less fees. */
  total: number;
  status: IncomeReportStatus;
  /**
   * Booked before the per-day voucher: one verksamhet's day, or a day of
   * Zettle fees. Read-only from here on. See lib/income/legacy.ts.
   */
  legacy: boolean;
  /**
   * Every verksamhet with sales on the day, by name. On an old report, the one
   * it was for, or none for a day of fees.
   */
  unitNames: string[];
  /** Every cost centre the day books to, by code. */
  costCenterCodes: string[];
  documentFilename: string | null;
  /** The Fortnox voucher, once exported, e.g. "IR-142". */
  voucherLabel: string | null;
  /**
   * A voucher Fortnox already held for some of this source's money on this
   * day when the report was imported, "IR-142". The day is shown all the same;
   * this is what colours it as a warning.
   */
  existingVoucher: string | null;
  /**
   * A report booked here that already holds some of this day's money, its
   * voucher label if it has one. Null when there is none. Distinct from
   * `existingVoucher`: this one cannot be booked at all.
   */
  duplicateOf: { id: string; voucherLabel: string | null } | null;
  /** Which fetch brought this day in, for the provenance column. */
  batchId: string;
  importedAt: string;
  /**
   * When the row last changed, a line corrected above all.
   *
   * It is in the row because of the document. A draft's intäktsräkning is
   * rendered on the way past and held by the browser for five minutes
   * (api/income/reports/[id]/document), which is right for stepping back to a
   * day you just looked at and wrong the moment a line is corrected. Hung on
   * the document's URL, this makes the corrected report a different address.
   */
  updatedAt: string;
  /**
   * Who wrote the kontering: whoever konterade the day and whoever wrote it by
   * hand. Neither may granska and bokföra it (lib/domain/review.ts).
   */
  bookedBy: string[];
  /** Who konterade the day, and when. Null until it is konterad. */
  reviewedByName: string | null;
  reviewedAt: string | null;
  lines: IncomeLineRow[];
  /**
   * A kontering written by hand, or null when the day books the rows its lines
   * give. See lib/income/manual-voucher.ts.
   */
  manual: {
    /** Every row but the clearing account, kronor. */
    rows: {
      account: string;
      accountName: string;
      costCenterCode: string | null;
      project: string | null;
      description: string | null;
      debit: number;
      credit: number;
    }[];
    /** A line has changed since it was written, so it cannot be booked as it is. */
    stale: boolean;
    byName: string | null;
    at: string | null;
  } | null;
}

// What a report row is loaded with, wherever it is loaded: the review screen,
// the booked list. One include, so the lists cannot drift into showing subtly
// different things about the same day.
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
    // A day booked before the per-day voucher keeps its verksamhet on the
    // report, not the lines, and its fees in a report of their own. Read onto
    // the lines here, so the screens draw an old day the way they draw a new
    // one rather than as a day of unplaced sales.
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
 * A verksamhet a mis-routed sale can be given to, and the accounts it books
 * revenue to. See lib/income/lines.ts and the assign dialog.
 *
 * The accounts are the ones its product prefixes point at, which is the closest
 * thing to "where does this unit's money normally go" the routing table holds.
 * They are offered first in the picker rather than imposed: a unit that sells
 * beer and food has two, and which one a mis-sold line belongs to is not
 * recoverable from the line. The routing strips the prefix off the product
 * name, so a line in the reserv never carried one.
 */
export interface IncomeMoveTarget {
  resultUnitId: string;
  /** As the documents name it: the properName override, else the unit's own. */
  name: string;
  accounts: { account: string; accountName: string; prefixes: string[] }[];
  /**
   * The unit's own cost centres: active ones whose code its result-unit prefix
   * matches (lib/server/result-units.ts). Offered first when a day's sales for
   * the unit are given a cost centre.
   */
  costCenterCodes: string[];
}

/**
 * Every verksamhet still taking money in, as places to give a sale to.
 *
 * Inactive ones are left out for the same reason the routing drops them
 * (lib/income/config.ts): a verksamhet that has stopped selling takes no new
 * takings.
 */
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
      // One entry per distinct account, carrying the prefixes that route to it
      // "3011 - öl, öl2" says more about what the account is for than its
      // name from the chart does.
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

/**
 * Every day of one of Intäkter's pages, Zettle or Swish, newest first: the
 * ones waiting to be konterade, the konterade ones waiting to be bokförda, and
 * the bokförda. The stage is a tab on the page, cut in the browser.
 */
export async function getIncomeReports(slug: IncomeSourceSlug): Promise<IncomeReportRow[]> {
  const reports = await prisma.incomeReport.findMany({
    where: { source: { in: sourcesOf(slug) } },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    include: REPORT_INCLUDE,
  });
  return reports.map(reportRow);
}

/** One row of a stored verifikation, as the day's page shows it. Kronor. */
export interface IncomeVoucherRow {
  account: string;
  accountName: string;
  costCenterCode: string | null;
  project: string | null;
  description: string | null;
  debit: number;
  credit: number;
}

/** A day, and what its page needs beyond the list row. */
export interface IncomeReportDetail {
  report: IncomeReportRow;
  /** The verifikation as konterad, once it is. */
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
