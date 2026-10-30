// Reading the income routing table for the settings screen.
//
// The same rows lib/income/config.ts serialises for the intakt service. This
// is the other half, the one a person edits.
import "server-only";

import { oreToSEK } from "@/lib/domain/money";
import { prisma } from "@/lib/server/db";
import {
  loadBookkeepingSettings,
  type BookkeepingSettingsValues,
} from "@/lib/server/bookkeeping-settings";

interface IncomePrefixRow {
  id: string;
  code: string;
  /** The income profile it routes to, ResultUnitIncome.id. */
  incomeId: string;
  account: string;
  /** The account's name from the chart, or "" when it is not in it. */
  accountName: string;
}

/**
 * A resultatenhet as the income settings screen shows it: the unit, and its
 * income profile when it has one.
 *
 * Every unit is listed, with or without income. That is the point of there
 * being one register. A unit with `income: null` is one that takes no money in,
 * and the screen offers to give it settings rather than hiding it.
 */
interface IncomeUnitRow {
  /** ResultUnit.id, the unit itself, which exists either way. */
  resultUnitId: string;
  name: string;
  /** How many cost centres it owns through its prefixes, for context. */
  costCentreCount: number;
  income: IncomeProfileRow | null;
  /** Whether anything has been booked under it: a unit in use is retired, not deleted. */
  inUse: boolean;
}

interface IncomeProfileRow {
  /** ResultUnitIncome.id, what the profile routes hang off. */
  id: string;
  key: string;
  /** Null means the unit's own name is what the documents say. */
  properName: string | null;
  description: string;
  defaultCostCenterId: string | null;
  defaultCostCenterCode: string | null;
  active: boolean;
  prefixes: IncomePrefixRow[];
}

interface SwishFallbackRow {
  /** SEK, for display. The database keeps öre. */
  amount: number;
  message: string;
}

// Null is "not chosen yet". See lib/server/bookkeeping-settings.ts.
export interface IncomeSettingsRow {
  zettleClearingAccount: string | null;
  swishClearingAccount: string | null;
  zettleFeeAccount: string | null;
  zettleFeeCostCenterId: string | null;
  /** The same cost centre as a code, what the booking screen's picker works in. */
  zettleFeeCostCenterCode: string | null;
  /** The verifikationsserie takings export to; null means the connection's. */
  incomeVoucherSeries: string | null;
  /** Where a sale matching no prefix goes: an income profile, and an account. */
  incomeFallbackIncomeId: string | null;
  incomeFallbackAccount: string | null;
  /**
   * What that null falls back to: the series everything else is exported to.
   *
   * Carried so the settings screen can say what "unset" actually means rather
   * than leaving an empty box that reads as "nowhere". Null when Fortnox has
   * never been connected, which is a way this app is run.
   */
  connectionVoucherSeries: string | null;
}

export interface IncomeConfigView {
  units: IncomeUnitRow[];
  fallbacks: SwishFallbackRow[];
  settings: IncomeSettingsRow;
  /** Accounts a prefix may point at, so the screen can warn about one that isn't in the chart. */
  knownAccounts: string[];
}

/**
 * Where income lands, on its own: the four settings the booking screen needs
 * to build a voucher, without the whole routing table behind them.
 *
 * Read from the same row the booking route reads, with no defaults of its own,
 * so a screen cannot show a clearing account the server would not use.
 */
export async function getIncomeSettings(): Promise<IncomeSettingsRow> {
  const [row, connection] = await Promise.all([
    loadBookkeepingSettings(),
    prisma.fortnoxConnection.findFirst({ select: { voucherSeries: true } }),
  ]);
  return incomeSettingsRow(row, connection?.voucherSeries ?? null);
}

function incomeSettingsRow(
  row: BookkeepingSettingsValues,
  connectionVoucherSeries: string | null,
): IncomeSettingsRow {
  return {
    zettleClearingAccount: row.zettleClearingAccount,
    swishClearingAccount: row.swishClearingAccount,
    zettleFeeAccount: row.zettleFeeAccount,
    zettleFeeCostCenterId: row.zettleFeeCostCenterId,
    zettleFeeCostCenterCode: row.zettleFeeCostCenterCode,
    incomeVoucherSeries: row.incomeVoucherSeries,
    incomeFallbackIncomeId: row.incomeFallbackIncomeId,
    incomeFallbackAccount: row.incomeFallbackAccount,
    connectionVoucherSeries,
  };
}

export async function getIncomeConfig(): Promise<IncomeConfigView> {
  const [units, accounts, settings, connection, fallbacks, used] = await Promise.all([
    // Every result unit, income or not, one register, so the screen shows the
    // whole of it and says which rows have income settings.
    prisma.resultUnit.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { prefixes: true } },
        income: {
          include: {
            defaultCostCenter: { select: { id: true, code: true } },
            prefixes: { orderBy: { code: "asc" } },
          },
        },
      },
    }),
    prisma.account.findMany({ select: { number: true, name: true } }),
    loadBookkeepingSettings(),
    // Only for what the income series falls back to when it is unset. See
    // IncomeSettingsRow.connectionVoucherSeries.
    prisma.fortnoxConnection.findFirst({ select: { voucherSeries: true } }),
    prisma.swishAmountFallback.findMany({ orderBy: { amount: "asc" } }),
    // Which units have reports against them. One grouped query rather than a
    // count per unit. The screen only needs "any".
    prisma.incomeReport.groupBy({ by: ["resultUnitId"], _count: { _all: true } }),
  ]);

  const accountName = new Map(accounts.map((a) => [a.number, a.name]));
  const inUse = new Set(used.map((u) => u.resultUnitId).filter((id): id is string => Boolean(id)));

  return {
    units: units.map((u) => ({
      resultUnitId: u.id,
      name: u.name,
      costCentreCount: u._count.prefixes,
      inUse: inUse.has(u.id),
      income: u.income && {
        id: u.income.id,
        key: u.income.key,
        properName: u.income.properName,
        description: u.income.description,
        defaultCostCenterId: u.income.defaultCostCenter?.id ?? null,
        defaultCostCenterCode: u.income.defaultCostCenter?.code ?? null,
        active: u.income.active,
        prefixes: u.income.prefixes.map((p) => ({
          id: p.id,
          code: p.code,
          incomeId: p.incomeId,
          account: p.account,
          accountName: accountName.get(p.account) ?? "",
        })),
      },
    })),
    fallbacks: fallbacks.map((f) => ({ amount: oreToSEK(f.amount), message: f.message })),
    settings: incomeSettingsRow(settings, connection?.voucherSeries ?? null),
    knownAccounts: accounts.map((a) => a.number),
  };
}
