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

// Money here is SEK, not öre: these cross into the browser and are rendered
// by <Amount>, and the repo's rule is that the database keeps öre and the
// interface shows kronor (lib/domain/money.ts).
export interface IncomeLineRow {
  id: string;
  name: string;
  variant: string | null;
  account: string;
  accountName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
}

export interface IncomeReportRow {
  id: string;
  source: IncomeSource;
  date: string;
  total: number;
  status: IncomeReportStatus;
  /**
   * Whose takings these are. Null for Zettle's own fees, which are nobody's.
   *
   * The id rather than only the name because moving lines is a question about
   * units, not about what they are called: the move dialog has to leave this
   * day's own unit out of the destinations it offers.
   */
  resultUnitId: string | null;
  /** The verksamhet's income key, as intakt files its reports under. */
  unitKey: string | null;
  /** What the day is called on screen: the result unit's name. */
  unitName: string | null;
  /**
   * The unit's voucher text, "Sexmästeriets verksamhet". What the verifikation
   * is called, and therefore how the day is recognised in Fortnox
   * (lib/income/duplicate.ts); the booking screen shows the text it will get.
   */
  unitDescription: string | null;
  costCenterId: string | null;
  costCenterCode: string | null;
  /**
   * The committee's default cost centre, whether or not this day carries it.
   *
   * The import copies the default onto the report, so normally the two agree.
   * They don't for a day fetched before the committee had a default, or before
   * someone set one, and those days would otherwise open with the field blank
   * and refuse to book, with the answer sitting in the settings all along.
   */
  defaultCostCenterCode: string | null;
  documentFilename: string | null;
  /** The Fortnox voucher, once exported, e.g. "IR-142". */
  voucherLabel: string | null;
  /**
   * A voucher Fortnox already held for this source, verksamhet and day when the
   * report was imported, "IR-142". The day is shown and bookable all the same;
   * this is what colours it as a warning.
   */
  existingVoucher: string | null;
  /**
   * The same day, already booked here, its voucher label if it has one, else
   * an empty string. Null when there is no such report.
   *
   * Distinct from `existingVoucher`: this one cannot be booked at all, because
   * the section already has the verifikation.
   */
  duplicateOf: { id: string; voucherLabel: string | null } | null;
  /** Which fetch brought this day in, for the provenance column. */
  batchId: string;
  importedAt: string;
  /**
   * When the row last changed, moving lines onto or off it, above all.
   *
   * It is in the row because of the document. A draft's intäktsräkning is
   * rendered on the way past and held by the browser for five minutes
   * (api/income/reports/[id]/document), which is right for stepping back to a
   * day you just looked at and wrong the moment a move rewrites what the day
   * contains. Hung on the document's URL, this makes the corrected report a
   * different address, so what comes back is the corrected PDF.
   */
  updatedAt: string;
  lines: IncomeLineRow[];
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// What a report row is loaded with, wherever it is loaded: the review screen,
// the booked list, a batch. One include, so the four lists cannot drift into
// showing subtly different things about the same day.
const REPORT_INCLUDE = {
  resultUnit: {
    select: {
      name: true,
      income: {
        select: {
          key: true,
          properName: true,
          description: true,
          defaultCostCenter: { select: { code: true } },
        },
      },
    },
  },
  costCenter: { select: { id: true, code: true } },
  lines: { orderBy: { sortOrder: "asc" } },
  verification: { select: { fortnoxSeries: true, fortnoxNumber: true } },
  duplicateOf: {
    select: {
      id: true,
      verification: { select: { fortnoxSeries: true, fortnoxNumber: true } },
    },
  },
} as const;

type LoadedReport = Prisma.IncomeReportGetPayload<{ include: typeof REPORT_INCLUDE }>;

function reportRow(r: LoadedReport): IncomeReportRow {
  return {
    id: r.id,
    source: r.source,
    date: isoDate(r.date),
    total: oreToSEK(r.total),
    status: r.status,
    resultUnitId: r.resultUnitId,
    unitKey: r.resultUnit?.income?.key ?? null,
    // The override if the documents need one, else the unit's own name.
    unitName: r.resultUnit ? (r.resultUnit.income?.properName ?? r.resultUnit.name) : null,
    // A unit whose income settings were removed after booking still has to say
    // whose takings the day was, so its name stands in.
    unitDescription: r.resultUnit?.income?.description ?? r.resultUnit?.name ?? null,
    costCenterId: r.costCenter?.id ?? null,
    costCenterCode: r.costCenter?.code ?? null,
    defaultCostCenterCode: r.resultUnit?.income?.defaultCostCenter?.code ?? null,
    documentFilename: r.documentFilename,
    voucherLabel:
      r.verification?.fortnoxSeries && r.verification.fortnoxNumber
        ? `${r.verification.fortnoxSeries}-${r.verification.fortnoxNumber}`
        : null,
    existingVoucher: r.existingVoucher,
    duplicateOf: r.duplicateOf && {
      id: r.duplicateOf.id,
      voucherLabel:
        r.duplicateOf.verification?.fortnoxSeries && r.duplicateOf.verification.fortnoxNumber
          ? `${r.duplicateOf.verification.fortnoxSeries}-${r.duplicateOf.verification.fortnoxNumber}`
          : null,
    },
    batchId: r.batchId,
    importedAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    lines: r.lines.map((l) => ({
      id: l.id,
      name: l.name,
      variant: l.variant,
      account: l.account,
      accountName: l.accountName,
      quantity: l.quantity,
      unitPrice: oreToSEK(l.unitPrice),
      discount: oreToSEK(l.discount),
      total: oreToSEK(l.total),
    })),
  };
}

/**
 * A verksamhet a mis-routed sale can be moved to, and the accounts it books
 * revenue to. See lib/income/move.ts and the move dialog.
 *
 * The accounts are the ones its product prefixes point at, which is the closest
 * thing to "where does this unit's money normally go" the routing table holds.
 * They are offered first in the picker rather than imposed: a unit that sells
 * beer and food has two, and which one a mis-sold line belongs to is not
 * recoverable from the line. intakt strips the prefix off the product name
 * when it routes, so a line in the fallback never carried one.
 */
export interface IncomeMoveTarget {
  resultUnitId: string;
  /** As the documents name it: the properName override, else the unit's own. */
  name: string;
  accounts: { account: string; accountName: string; prefixes: string[] }[];
}

/**
 * Every verksamhet still taking money in, as move destinations.
 *
 * Inactive ones are left out for the same reason `buildIntaktConfig` drops
 * them: they are not in the routing table sent to the service, so a report
 * under one could not be rendered.
 */
export async function getIncomeMoveTargets(): Promise<IncomeMoveTarget[]> {
  const [units, accounts] = await Promise.all([
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
  ]);
  const accountName = new Map(accounts.map((a) => [a.number, a.name]));

  return units
    .map((u) => {
      // One entry per distinct account, carrying the prefixes that route to it
      // "3011 – öl, öl2" says more about what the account is for than its
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
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

/** The working set: what the last fetch brought back, and what it could not. */
export interface IncomeReviewQueue {
  /** The fetch on the table. Null before anything has been fetched. */
  batch: { id: string; source: IncomeSource; fromDate: string; toDate: string } | null;
  /** Everything unbooked, oldest day first. */
  reports: IncomeReportRow[];
}

/**
 * The days to go through: everything fetched and not yet booked, oldest first.
 *
 * This is a working set, not a record. A fetch clears it and puts back whatever
 * came in, so what is here is exactly the last fetch, and the only durable
 * income state is the booked and exported reports (see createSalesBatch). A
 * day nobody books is simply left here until the next fetch sweeps it away.
 */
export async function getIncomeReviewQueue(): Promise<IncomeReviewQueue> {
  const [reports, batch] = await Promise.all([
    prisma.incomeReport.findMany({
      where: { status: "DRAFT" },
      orderBy: [{ date: "asc" }, { source: "asc" }, { id: "asc" }],
      include: REPORT_INCLUDE,
    }),
    prisma.incomeBatch.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, source: true, fromDate: true, toDate: true },
    }),
  ]);

  return {
    batch: batch && {
      id: batch.id,
      source: batch.source,
      fromDate: isoDate(batch.fromDate),
      toDate: isoDate(batch.toDate),
    },
    reports: reports.map(reportRow),
  };
}

/**
 * The durable half: every day that has been booked, newest first.
 *
 * The only income state that outlives a fetch. Drafts are scratch, see
 * getIncomeReviewQueue, so this is the section's actual record of what it took
 * in, and what has been pushed to Fortnox. A day reopened for correction leaves
 * this list the moment it is unbooked: it is back in the queue, waiting to be
 * booked again like anything else there.
 */
export async function getBookedIncome(limit = 1000): Promise<IncomeReportRow[]> {
  const reports = await prisma.incomeReport.findMany({
    where: { status: { in: ["BOOKED", "EXPORTED"] } },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: limit,
    include: REPORT_INCLUDE,
  });
  return reports.map(reportRow);
}
