// The voucher a day of takings will be posted as: derived by the booking route's function (buildDayVoucherLines in
// lib/income/voucher.ts), or the hand-written rows saved with a fingerprint of the lines (lib/income/manual-voucher.ts).
// Nothing here holds an edited voucher. Pure over plain data.
import { oreToSEK, sekToOre } from "@/lib/domain/money";
import type { IncomeLineRow, IncomeReportRow } from "@/lib/data/income";
import type { IncomeSettingsRow } from "@/lib/data/income-config";
import type { AccountRecord, CostCenter, ProjectRecord } from "@/lib/domain/types";
import { clearingRow, manualVoucherBlocker } from "@/lib/income/manual-voucher";
import { buildDayVoucherLines, incomeVoucherBlocker } from "@/lib/income/voucher";

export interface VoucherPreviewRow {
  account: string;
  accountName: string;
  costCenterCode: string | null;
  project?: string | null;
  description?: string | null;
  debit: number;
  credit: number;
}

/** Why a day cannot be booked yet, the first reason that applies: a message key under `income.blocker`. */
export type DayBlocker =
  | "alreadyBooked"
  | "manualStale"
  | "manualInvalid"
  | "unknownProject"
  | "noClearingAccount"
  | "unknownClearingAccount"
  | "unplacedLines"
  | "noFeeAccount"
  | "noAccount"
  | "unknownAccount"
  | "noCostCenter"
  | "inactiveCostCenter"
  | "noDistributions"
  | "unbalanced";

export interface DayVoucher {
  rows: VoucherPreviewRow[];
  clearing: string;
  totalDebit: number;
  totalCredit: number;
  blocker: DayBlocker | null;
  canBook: boolean;
}

const nameOf = (accounts: AccountRecord[], number: string) =>
  accounts.find((a) => a.number === number)?.name ?? number;

/** Where to read a day's intäktsräkning, stamped with when the report last changed so a corrected day is a new address (the browser caches for five minutes). */
export const documentUrl = (report: IncomeReportRow) =>
  `/api/income/reports/${report.id}/document?v=${encodeURIComponent(report.updatedAt)}`;

const clearingAccountFor = (report: IncomeReportRow, settings: IncomeSettingsRow) =>
  (report.source === "SWISH" ? settings.swishClearingAccount : settings.zettleClearingAccount) ??
  "";

const moving = (lines: readonly IncomeLineRow[]) => lines.filter((l) => l.total !== 0);

export interface LineFindings {
  unplaced: number;
  noCostCenter: number;
  inactive: string[];
  local: string[];
}

export function lineFindings(report: IncomeReportRow, costCenters: CostCenter[]): LineFindings {
  const lines = moving(report.lines);
  const byCode = new Map(costCenters.map((c) => [c.code, c]));
  const codes = (pick: (c: CostCenter) => boolean) =>
    [
      ...new Set(
        lines.flatMap((l) => {
          const cc = l.costCenterCode ? byCode.get(l.costCenterCode) : undefined;
          return cc && pick(cc) ? [cc.code] : [];
        }),
      ),
    ].sort();
  return {
    unplaced: lines.filter((l) => l.kind === "SALE" && (l.unmatched || !l.resultUnitId)).length,
    noCostCenter: lines.filter((l) => !l.costCenterCode).length,
    inactive: codes((c) => !c.active),
    local: codes((c) => c.source !== "FORTNOX"),
  };
}

export function dayVoucher({
  report,
  settings,
  accounts,
  costCenters,
  projects = [],
}: {
  report: IncomeReportRow;
  settings: IncomeSettingsRow;
  accounts: AccountRecord[];
  costCenters: CostCenter[];
  projects?: ProjectRecord[];
}): DayVoucher {
  const clearing = clearingAccountFor(report, settings);
  // The code stands in for the id: one code is one cost centre, so rows group as the server's do.
  const input = {
    lines: report.lines.map((l) => ({
      account: l.account,
      costCenterId: l.costCenterCode,
      total: sekToOre(l.total),
    })),
    total: sekToOre(report.total),
    clearingAccount: clearing,
    accountName: (n: string) => nameOf(accounts, n),
  };

  if (report.manual) return manualVoucher(report, clearing, accounts, costCenters, projects);

  const built = buildDayVoucherLines(input);
  const rows = built.map((r) => ({
    account: r.account,
    accountName: r.accountName,
    costCenterCode: r.costCenterId,
    debit: oreToSEK(r.debit),
    credit: oreToSEK(r.credit),
  }));

  const blocker = blockerFor(report, input, clearing, accounts, costCenters);
  return {
    rows,
    clearing,
    totalDebit: oreToSEK(built.reduce((s, r) => s + r.debit, 0)),
    totalCredit: oreToSEK(built.reduce((s, r) => s + r.credit, 0)),
    blocker,
    canBook: blocker === null,
  };
}

/** A kontering written by hand: its rows, then the clearing row (the day's total). Held to the booking route's rules. */
function manualVoucher(
  report: IncomeReportRow,
  clearing: string,
  accounts: AccountRecord[],
  costCenters: CostCenter[],
  projects: ProjectRecord[],
): DayVoucher {
  const manual = report.manual!;
  const total = sekToOre(report.total);
  const side = clearingRow(total);
  const rows: VoucherPreviewRow[] = [
    ...manual.rows,
    ...(side
      ? [
          {
            account: clearing,
            accountName: nameOf(accounts, clearing),
            costCenterCode: null,
            debit: oreToSEK(side.debit),
            credit: oreToSEK(side.credit),
          },
        ]
      : []),
  ];

  const blocker = manualBlockerFor(report, total, clearing, accounts, costCenters, projects);
  return {
    rows,
    clearing,
    totalDebit: oreToSEK(rows.reduce((s, r) => s + sekToOre(r.debit), 0)),
    totalCredit: oreToSEK(rows.reduce((s, r) => s + sekToOre(r.credit), 0)),
    blocker,
    canBook: blocker === null,
  };
}

function manualBlockerFor(
  report: IncomeReportRow,
  total: number,
  clearing: string,
  accounts: AccountRecord[],
  costCenters: CostCenter[],
  projects: ProjectRecord[],
): DayBlocker | null {
  const manual = report.manual!;
  if (report.duplicateOf) return "alreadyBooked";
  if (manual.stale) return "manualStale";
  if (!clearing) return "noClearingAccount";
  if (!accounts.some((a) => a.number === clearing)) return "unknownClearingAccount";
  if (report.lines.some((l) => l.kind === "SALE" && !l.resultUnitId && l.total !== 0)) {
    return "unplacedLines";
  }
  if (manual.rows.some((r) => !accounts.some((a) => a.number === r.account))) {
    return "unknownAccount";
  }
  const byCode = new Map(costCenters.map((c) => [c.code, c]));
  if (manual.rows.some((r) => r.costCenterCode && byCode.get(r.costCenterCode)?.active === false)) {
    return "inactiveCostCenter";
  }
  if (manual.rows.some((r) => r.project && !projects.some((p) => p.number === r.project))) {
    return "unknownProject";
  }
  const invalid = manualVoucherBlocker(
    manual.rows.map((r) => ({
      account: r.account,
      costCenter: r.costCenterCode,
      debit: sekToOre(r.debit),
      credit: sekToOre(r.credit),
    })),
    total,
  );
  return invalid ? "manualInvalid" : null;
}

function blockerFor(
  report: IncomeReportRow,
  input: Parameters<typeof incomeVoucherBlocker>[0],
  clearing: string,
  accounts: AccountRecord[],
  costCenters: CostCenter[],
): DayBlocker | null {
  if (report.duplicateOf) return "alreadyBooked";
  if (!clearing) return "noClearingAccount";
  if (!accounts.some((a) => a.number === clearing)) return "unknownClearingAccount";

  const lines = moving(report.lines);
  if (lines.some((l) => l.kind === "SALE" && !l.resultUnitId)) return "unplacedLines";

  const blocker = incomeVoucherBlocker(input);
  if (blocker === "noAccount") {
    return lines.some((l) => l.kind === "FEE" && !l.account) ? "noFeeAccount" : "noAccount";
  }
  if (blocker === "noClearingAccount") return "noClearingAccount";
  if (blocker) return blocker;

  if (lines.some((l) => !accounts.some((a) => a.number === l.account))) return "unknownAccount";
  const byCode = new Map(costCenters.map((c) => [c.code, c]));
  if (lines.some((l) => l.costCenterCode && byCode.get(l.costCenterCode)?.active === false)) {
    return "inactiveCostCenter";
  }
  return null;
}
