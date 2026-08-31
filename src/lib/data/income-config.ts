// Reading the income routing table for the settings screen.
//
// The same rows lib/income/config.ts serialises for the intakt service. This
// is the other half, the one a person edits.
import "server-only";

import { oreToSEK } from "@/lib/domain/money";
import { prisma } from "@/lib/server/db";

export interface IncomePrefixRow {
  id: string;
  code: string;
  /** The income profile it routes to, ResultUnitIncome.id. */
  incomeId: string;
  account: string;
  /** The account's name from the chart, or "" when it is not in it. */
  accountName: string;
  isFallback: boolean;
}

/**
 * A resultatenhet as the income settings screen shows it: the unit, and its
 * income profile when it has one.
 *
 * Every unit is listed, with or without income. That is the point of there
 * being one register. A unit with `income: null` is one that takes no money in,
 * and the screen offers to give it settings rather than hiding it.
 */
export interface IncomeUnitRow {
  /** ResultUnit.id, the unit itself, which exists either way. */
  resultUnitId: string;
  name: string;
  /** How many cost centres it owns through its prefixes, for context. */
  costCentreCount: number;
  income: IncomeProfileRow | null;
  /** Whether anything has been booked under it: a unit in use is retired, not deleted. */
  inUse: boolean;
}

export interface IncomeProfileRow {
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

export interface SwishFallbackRow {
  /** SEK, for display. The database keeps öre. */
  amount: number;
  message: string;
}

export interface IncomeSettingsRow {
  zettleClearingAccount: string;
  swishClearingAccount: string;
  zettleFeeAccount: string;
  zettleFeeCostCenterId: string | null;
  /** The same cost centre as a code, what the booking screen's picker works in. */
  zettleFeeCostCenterCode: string | null;
  /** The verifikationsserie takings export to; null means the connection's. */
  incomeVoucherSeries: string | null;
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
 * The defaults are the ones the booking route falls back to, spelled once here
 * so a screen cannot show a clearing account the server would not have used.
 */
export async function getIncomeSettings(): Promise<IncomeSettingsRow> {
  const [row, connection] = await Promise.all([
    prisma.bookkeepingSettings.findUnique({
      where: { id: "singleton" },
      include: { zettleFeeCostCenter: { select: { code: true } } },
    }),
    prisma.fortnoxConnection.findFirst({ select: { voucherSeries: true } }),
  ]);
  return {
    zettleClearingAccount: row?.zettleClearingAccount ?? "1930",
    swishClearingAccount: row?.swishClearingAccount ?? "1931",
    zettleFeeAccount: row?.zettleFeeAccount ?? "6570",
    zettleFeeCostCenterId: row?.zettleFeeCostCenterId ?? null,
    zettleFeeCostCenterCode: row?.zettleFeeCostCenter?.code ?? null,
    incomeVoucherSeries: row?.incomeVoucherSeries ?? null,
    connectionVoucherSeries: connection?.voucherSeries ?? null,
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
    prisma.bookkeepingSettings.findUnique({
      where: { id: "singleton" },
      include: { zettleFeeCostCenter: { select: { code: true } } },
    }),
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
          isFallback: p.isFallback,
        })),
      },
    })),
    fallbacks: fallbacks.map((f) => ({ amount: oreToSEK(f.amount), message: f.message })),
    settings: {
      zettleClearingAccount: settings?.zettleClearingAccount ?? "1930",
      swishClearingAccount: settings?.swishClearingAccount ?? "1931",
      zettleFeeAccount: settings?.zettleFeeAccount ?? "6570",
      zettleFeeCostCenterId: settings?.zettleFeeCostCenterId ?? null,
      zettleFeeCostCenterCode: settings?.zettleFeeCostCenter?.code ?? null,
      incomeVoucherSeries: settings?.incomeVoucherSeries ?? null,
      connectionVoucherSeries: connection?.voucherSeries ?? null,
    },
    knownAccounts: accounts.map((a) => a.number),
  };
}
