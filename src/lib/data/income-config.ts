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
  /** Its own cost centre, or null for the verksamhet's default. */
  costCenterId: string | null;
}

/** A resultatenhet with its income profile; `income: null` means it takes no money in. Every unit is listed. */
interface IncomeUnitRow {
  resultUnitId: string;
  name: string;
  costCentreCount: number;
  income: IncomeProfileRow | null;
  /** Whether anything has been booked under it: a unit in use is retired, not deleted. */
  inUse: boolean;
}

interface IncomeProfileRow {
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
  zettleFeeCostCenterCode: string | null;
  /** The verifikationsserie takings export to; null means the connection's. */
  incomeVoucherSeries: string | null;
  incomeFallbackIncomeId: string | null;
  incomeFallbackAccount: string | null;
  /** What the null falls back to: the series everything else is exported to. Null if Fortnox was never connected. */
  connectionVoucherSeries: string | null;
}

export interface IncomeConfigView {
  units: IncomeUnitRow[];
  fallbacks: SwishFallbackRow[];
  settings: IncomeSettingsRow;
  knownAccounts: string[];
}

/** The four settings the booking screen needs, read from the same row the booking route reads, with no defaults. */
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
    prisma.fortnoxConnection.findFirst({ select: { voucherSeries: true } }),
    prisma.swishAmountFallback.findMany({ orderBy: { amount: "asc" } }),
    // Units with takings: an old per-verksamhet report, or a sold line on a per-day one. Only "any" is needed.
    Promise.all([
      prisma.incomeReport.groupBy({ by: ["resultUnitId"], _count: { _all: true } }),
      prisma.incomeLine.groupBy({ by: ["resultUnitId"], _count: { _all: true } }),
    ]).then(([reports, lines]) => [...reports, ...lines]),
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
          costCenterId: p.costCenterId,
        })),
      },
    })),
    fallbacks: fallbacks.map((f) => ({ amount: oreToSEK(f.amount), message: f.message })),
    settings: incomeSettingsRow(settings, connection?.voucherSeries ?? null),
    knownAccounts: accounts.map((a) => a.number),
  };
}
