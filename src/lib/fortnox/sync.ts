// Pull the Fortnox ledger into the local mirror via SIE. Sync is done a whole
// financial year at a time: fetch the year's SIE, parse it, and replace that
// year's vouchers+rows in one transaction. That makes every sync idempotent —
// closed years stay identical, the current year just gets re-pulled — and
// sidesteps per-voucher fetching (and the API rate limit) entirely.
import { randomUUID } from "crypto";
import { prisma } from "@/lib/server/db";
import {
  fetchSie,
  getServiceToken,
  listAccounts,
  listCostCenters,
  listFinancialYears,
  type FortnoxFinancialYear,
} from "@/lib/fortnox";
import { parseSie } from "@/lib/fortnox/sie";
import type { Prisma } from "@/lib/generated/prisma/client";

const toOre = (sek: number) => Math.round(sek * 100);

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

// Rows per upsert statement. Postgres caps a statement at 65535 bound
// parameters; at six columns a chart of accounts would have to be ten thousand
// rows long to come near it, and a smaller statement keeps the plan cheap.
const UPSERT_CHUNK = 500;

/**
 * The rows of `list`, one per key, keeping the last of any repeat.
 *
 * A loop of single-row upserts simply overwrote its own work if Fortnox listed
 * a code twice; one statement upserting the batch cannot — Postgres refuses an
 * ON CONFLICT DO UPDATE that would touch the same row a second time, and the
 * whole sync would fail on a duplicate somewhere upstream. Last one wins, which
 * is what the loop did.
 */
function lastByKey<T>(list: readonly T[], key: (item: T) => string): T[] {
  return [...new Map(list.map((item) => [key(item), item])).values()];
}

/**
 * `($1,$2,$3),($4,$5,$6),…` for a multi-row VALUES, plus the flat parameter
 * list to go with it. `casts` types individual columns where Postgres cannot
 * infer it from context — an enum column, most of all.
 */
function valuesClause(
  rows: readonly unknown[][],
  casts: Readonly<Record<number, string>> = {},
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const tuples = rows.map((row) => {
    const holders = row.map((value, col) => {
      params.push(value);
      const cast = casts[col];
      return cast ? `$${params.length}::${cast}` : `$${params.length}`;
    });
    return `(${holders.join(",")})`;
  });
  return { sql: tuples.join(","), params };
}

// Refresh the list of financial years (so the report's year picker and the
// sync know what exists). Returns them newest-first.
export async function syncFinancialYears(token: string): Promise<FortnoxFinancialYear[]> {
  const years = await listFinancialYears(token);
  for (const y of years) {
    await prisma.fortnoxFinancialYear.upsert({
      where: { id: y.id },
      create: { id: y.id, fromDate: new Date(y.fromDate), toDate: new Date(y.toDate) },
      update: { fromDate: new Date(y.fromDate), toDate: new Date(y.toDate) },
    });
  }
  return years.sort((a, b) => b.id - a.id);
}

export interface CostCenterSyncResult {
  upserted: number;
  deactivated: number;
  deleted: number;
}

// Sync the app's CostCenter list from Fortnox: the cost centres that are active
// in Fortnox become the selectable ones. Matching is by code — existing rows
// keep their result unit + attestant.
//
// Cost centres Fortnox still lists but has archived (Active: false) are only
// deactivated — Fortnox might unarchive them later. Ones Fortnox has dropped
// from the list entirely (deleted there) are removed here too, but only if
// nothing local points at them (an expense allocation, a verification line, or
// a budget sheet); otherwise deleting the row would orphan or destroy that
// history, so it is deactivated instead. Local (non-Fortnox) cost centres are
// excluded from all of this: nothing in Fortnox will ever list them, so they
// would otherwise be retired on every sync.
export async function syncCostCenters(token: string): Promise<CostCenterSyncResult> {
  const fortnoxCcs = await listCostCenters(token);
  const seenCodes = new Set(fortnoxCcs.map((c) => c.code));

  // One statement per chunk rather than one per cost centre. `id` is only ever
  // written on insert — an existing row keeps the one every allocation,
  // verification line and budget sheet already points at.
  //
  // Fortnox now has this code, so it owns the row from here on: a local cost
  // centre that has since been created for real is adopted rather than
  // duplicated (the code is unique, so there is only ever the one row).
  const now = new Date();
  for (const chunk of chunks(lastByKey(fortnoxCcs, (c) => c.code), UPSERT_CHUNK)) {
    const { sql, params } = valuesClause(
      chunk.map((c) => [randomUUID(), c.code, c.description, c.active, "FORTNOX", now]),
      { 4: '"CostCenterSource"' },
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CostCenter" ("id","code","name","active","source","updatedAt")
       VALUES ${sql}
       ON CONFLICT ("code") DO UPDATE SET
         "name" = EXCLUDED."name",
         "active" = EXCLUDED."active",
         "source" = EXCLUDED."source",
         "updatedAt" = EXCLUDED."updatedAt"`,
      ...params,
    );
  }
  const upserted = fortnoxCcs.length;

  const gone = await prisma.costCenter.findMany({
    where: { code: { notIn: [...seenCodes] }, source: "FORTNOX" },
    select: {
      id: true,
      _count: { select: { allocations: true, verificationLines: true, budgetCostCenters: true } },
    },
  });
  const unreferencedIds = gone
    .filter((c) => c._count.allocations === 0 && c._count.verificationLines === 0 && c._count.budgetCostCenters === 0)
    .map((c) => c.id);

  const { count: deleted } = await prisma.costCenter.deleteMany({
    where: { id: { in: unreferencedIds } },
  });

  // Everything else that should no longer be selectable — archived-in-Fortnox
  // rows, plus deleted-from-Fortnox rows that are still referenced and so were
  // kept above — is deactivated rather than deleted.
  const { count: deactivated } = await prisma.costCenter.updateMany({
    where: {
      active: true,
      source: "FORTNOX",
      OR: [
        { code: { notIn: [...seenCodes] }, id: { notIn: unreferencedIds } },
        { code: { in: fortnoxCcs.filter((c) => !c.active).map((c) => c.code) } },
      ],
    },
    data: { active: false },
  });

  return { upserted, deactivated, deleted };
}

export interface AccountSyncResult {
  upserted: number;
  deactivated: number;
}

// Mirror the Fortnox chart of accounts. Accounts are upserted, never deleted —
// a budget line or an exported verification may still reference one Fortnox has
// retired, and losing its name would leave those rows unreadable. Retired
// accounts are marked inactive instead, which hides them from pickers.
export async function syncAccounts(
  token: string,
  financialYearId: number,
): Promise<AccountSyncResult> {
  const accounts = await listAccounts(token, financialYearId);
  const now = new Date();

  // A BAS chart is a thousand accounts and change. One statement per chunk, not
  // one round trip per account — the loop this replaced was the slowest part of
  // a sync by a wide margin, and all it was doing was waiting.
  for (const chunk of chunks(lastByKey(accounts, (a) => a.number), UPSERT_CHUNK)) {
    const { sql, params } = valuesClause(
      chunk.map((a) => [a.number, a.name, a.active, a.sru, now, now]),
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Account" ("number","name","active","sru","lastSyncAt","updatedAt")
       VALUES ${sql}
       ON CONFLICT ("number") DO UPDATE SET
         "name" = EXCLUDED."name",
         "active" = EXCLUDED."active",
         "sru" = EXCLUDED."sru",
         "lastSyncAt" = EXCLUDED."lastSyncAt",
         "updatedAt" = EXCLUDED."updatedAt"`,
      ...params,
    );
  }

  const { count: deactivated } = await prisma.account.updateMany({
    where: { number: { notIn: accounts.map((a) => a.number) }, active: true },
    data: { active: false },
  });

  return { upserted: accounts.length, deactivated };
}

export interface YearSyncResult {
  financialYear: number;
  vouchers: number;
  rows: number;
  balances: number;
}

// Replace one financial year's ledger from its SIE export. Assumes the
// FortnoxFinancialYear row already exists (syncLedger upserts it first).
async function syncYear(token: string, fyId: number): Promise<YearSyncResult> {
  const parsed = parseSie(await fetchSie(token, fyId));

  const voucherRecords: Prisma.LedgerVoucherCreateManyInput[] = [];
  const rowRecords: Prisma.LedgerRowCreateManyInput[] = [];

  // #IB/#UB (and the optional per-cost-centre #OIB/#OUB) — one row per
  // account+cost-centre key named by either record. Result accounts (3xxx+)
  // generally have neither and are simply absent.
  const balanceRecords: Prisma.LedgerAccountBalanceCreateManyInput[] = [
    ...new Set([...parsed.openingBalances.keys(), ...parsed.closingBalances.keys()]),
  ].map((key) => {
    const [account, costCenterCode] = key.split("|");
    return {
      financialYear: fyId,
      account,
      accountName: parsed.accounts.get(account) ?? "",
      costCenterCode: costCenterCode ?? "",
      opening: toOre(parsed.openingBalances.get(key) ?? 0),
      closing: toOre(parsed.closingBalances.get(key) ?? 0),
    };
  });

  for (const v of parsed.vouchers) {
    const voucherId = randomUUID();
    const date = new Date(`${v.date}T00:00:00Z`);
    voucherRecords.push({
      id: voucherId,
      financialYear: fyId,
      series: v.series,
      number: v.number,
      date,
      description: v.description,
    });
    for (const tr of v.transactions) {
      rowRecords.push({
        id: randomUUID(),
        voucherId,
        // Copied down from the voucher so a report can be answered without
        // joining back up to it — see LedgerRow in schema.prisma.
        financialYear: fyId,
        date,
        account: tr.account,
        accountName: parsed.accounts.get(tr.account) ?? "",
        costCenterCode: tr.costCenterCode ?? null,
        costCenterName: tr.costCenterCode
          ? parsed.costCenters.get(tr.costCenterCode) ?? null
          : null,
        text: tr.text ?? null,
        debit: tr.amount > 0 ? toOre(tr.amount) : 0,
        credit: tr.amount < 0 ? toOre(-tr.amount) : 0,
      });
    }
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.ledgerVoucher.deleteMany({ where: { financialYear: fyId } });
      await tx.ledgerAccountBalance.deleteMany({ where: { financialYear: fyId } });
      for (const chunk of chunks(voucherRecords, 1000)) {
        await tx.ledgerVoucher.createMany({ data: chunk });
      }
      for (const chunk of chunks(rowRecords, 2000)) {
        await tx.ledgerRow.createMany({ data: chunk });
      }
      for (const chunk of chunks(balanceRecords, 1000)) {
        await tx.ledgerAccountBalance.createMany({ data: chunk });
      }
      await tx.fortnoxFinancialYear.update({
        where: { id: fyId },
        data: { lastSyncAt: new Date() },
      });
    },
    { timeout: 120_000, maxWait: 15_000 },
  );

  return {
    financialYear: fyId,
    vouchers: voucherRecords.length,
    rows: rowRecords.length,
    balances: balanceRecords.length,
  };
}

export interface LedgerSyncResult {
  years: YearSyncResult[];
  costCenters?: CostCenterSyncResult;
}

// Entry point. scope "current" syncs only the year containing today (fast,
// one SIE call); "all" syncs every financial year (the full backfill); pass a
// specific `year` (Fortnox FY id) to sync just that one.
export async function syncLedger(opts: {
  scope: "current" | "all";
  /** Fortnox's id for one financial year — not a calendar year. */
  financialYearId?: number;
}): Promise<LedgerSyncResult> {
  const token = await getServiceToken();
  const years = await syncFinancialYears(token);

  // Refresh the cost-centre list too — best effort, since it needs the
  // `costcenter` scope which an older connection may not have granted.
  let costCenters: CostCenterSyncResult | undefined;
  try {
    costCenters = await syncCostCenters(token);
  } catch {
    costCenters = undefined;
  }

  let targets: FortnoxFinancialYear[];
  if (opts.financialYearId != null) {
    targets = years.filter((y) => y.id === opts.financialYearId);
  } else if (opts.scope === "current") {
    const today = new Date().toISOString().slice(0, 10);
    const containing = years.find((y) => y.fromDate <= today && today <= y.toDate);
    targets = containing ? [containing] : years.slice(0, 1); // newest as fallback
  } else {
    targets = years;
  }

  const results: YearSyncResult[] = [];
  for (const y of targets) results.push(await syncYear(token, y.id));
  return { years: results, costCenters };
}
