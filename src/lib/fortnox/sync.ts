// Pull the Fortnox ledger into the local mirror via SIE. Sync is done a whole
// financial year at a time: fetch the year's SIE, parse it, and replace that
// year's vouchers+rows in one transaction. That makes every sync idempotent:
// closed years stay identical, the current year just gets re-pulled, and
// sidesteps per-voucher fetching (and the API rate limit) entirely.
import { randomUUID } from "crypto";
import { prisma } from "@/lib/server/db";
import {
  fetchSie,
  getServiceToken,
  listAccounts,
  listCostCenters,
  listFinancialYears,
  listProjects,
  listSuppliers,
  type FortnoxFinancialYear,
} from "@/lib/fortnox";
import { rememberRegister } from "@/lib/server/supplier-register";
import { parseSie } from "@/lib/fortnox/sie";
import { voucherFingerprint } from "@/lib/closing/fingerprint";
import { Prisma } from "@/lib/generated/prisma/client";

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
 * a code twice; one statement upserting the batch cannot. Postgres refuses an
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
 * infer it from context, an enum column most of all.
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
  /** Rows Fortnox does not have that are still in use, now marked local. */
  madeLocal: number;
}

// Sync the app's CostCenter list from Fortnox: the cost centres that are active
// in Fortnox become the selectable ones. Matching is by code, existing rows
// keep their result unit + attestant.
//
// Cost centres Fortnox still lists but has archived (Active: false) are only
// deactivated, since Fortnox might unarchive them later. Ones Fortnox has dropped
// from the list entirely are removed here too, but only if nothing local points
// at them (an expense allocation, a verification line, or a budget sheet).
// Otherwise deleting the row would orphan or destroy that history, so it is
// marked local instead: Fortnox does not have the code, and a voucher naming
// it would be rejected, so the export must not send it (see
// lib/fortnox/export). That is how the alko cost centres the budget import
// created ended up here. They were never in Fortnox, and they were being sent.
// Its `active` is left as it was. An admin can retire a local cost centre.
//
// Local cost centres are excluded from all of this: nothing in Fortnox will
// ever list them, so they would otherwise be retired on every sync.
export async function syncCostCenters(token: string): Promise<CostCenterSyncResult> {
  const fortnoxCcs = await listCostCenters(token);
  const seenCodes = new Set(fortnoxCcs.map((c) => c.code));

  // One statement per chunk rather than one per cost centre. `id` is only ever
  // written on insert. An existing row keeps the one every allocation,
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

  // Not in Fortnox and still referenced, so kept above: local from here on.
  const { count: madeLocal } = await prisma.costCenter.updateMany({
    where: { source: "FORTNOX", code: { notIn: [...seenCodes] }, id: { notIn: unreferencedIds } },
    data: { source: "LOCAL" },
  });

  // Archived in Fortnox: no longer selectable, but kept, since Fortnox might
  // unarchive them.
  const { count: deactivated } = await prisma.costCenter.updateMany({
    where: {
      active: true,
      source: "FORTNOX",
      code: { in: fortnoxCcs.filter((c) => !c.active).map((c) => c.code) },
    },
    data: { active: false },
  });

  return { upserted, deactivated, deleted, madeLocal };
}

export interface AccountSyncResult {
  upserted: number;
  deactivated: number;
}

// Mirror the Fortnox chart of accounts. Accounts are upserted, never deleted:
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
  // one round trip per account. The loop this replaced was the slowest part of
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

export interface ProjectSyncResult {
  upserted: number;
  deactivated: number;
}

// Mirror the Fortnox project list, the way the chart of accounts is mirrored:
// upserted, never deleted, and whatever Fortnox no longer lists is marked
// inactive. A booked line may name a project that has since been closed.
export async function syncProjects(token: string): Promise<ProjectSyncResult> {
  const projects = await listProjects(token);
  const now = new Date();

  for (const chunk of chunks(lastByKey(projects, (p) => p.number), UPSERT_CHUNK)) {
    const { sql, params } = valuesClause(
      chunk.map((p) => [p.number, p.description, p.active, now]),
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Project" ("number","name","active","updatedAt")
       VALUES ${sql}
       ON CONFLICT ("number") DO UPDATE SET
         "name" = EXCLUDED."name",
         "active" = EXCLUDED."active",
         "updatedAt" = EXCLUDED."updatedAt"`,
      ...params,
    );
  }

  const { count: deactivated } = await prisma.project.updateMany({
    where: { number: { notIn: projects.map((p) => p.number) }, active: true },
    data: { active: false },
  });

  return { upserted: projects.length, deactivated };
}

interface YearSyncResult {
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

  // #IB/#UB (and the optional per-cost-centre #OIB/#OUB), one row per
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
    const rows: Prisma.LedgerRowCreateManyInput[] = [];
    for (const tr of v.transactions) {
      rows.push({
        id: randomUUID(),
        voucherId,
        // Copied down from the voucher so a report can be answered without
        // joining back up to it. See LedgerRow in schema.prisma.
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
    voucherRecords.push({
      id: voucherId,
      financialYear: fyId,
      series: v.series,
      number: v.number,
      date,
      description: v.description,
      // What a bokslut review is a review of. See lib/closing/fingerprint.ts.
      contentHash: voucherFingerprint({
        date: v.date,
        description: v.description,
        rows: rows.map((r) => ({
          account: r.account,
          costCenterCode: r.costCenterCode ?? null,
          text: r.text ?? null,
          debit: r.debit,
          credit: r.credit,
        })),
      }),
    });
    rowRecords.push(...rows);
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

interface LedgerSyncResult {
  years: YearSyncResult[];
  costCenters?: CostCenterSyncResult;
}

// Entry point. scope "current" syncs only the year containing today (fast,
// one SIE call); "all" syncs every financial year (the full backfill); pass a
// specific `year` (Fortnox FY id) to sync just that one.
export async function syncLedger(opts: {
  scope: "current" | "all";
  /** Fortnox's id for one financial year, not a calendar year. */
  financialYearId?: number;
}): Promise<LedgerSyncResult> {
  const token = await getServiceToken();
  const years = await syncFinancialYears(token);

  // Refresh the cost-centre list too, best effort, since it needs the
  // `costcenter` scope which an older connection may not have granted.
  let costCenters: CostCenterSyncResult | undefined;
  try {
    costCenters = await syncCostCenters(token);
  } catch {
    costCenters = undefined;
  }
  // The same for projects, which need the `project` scope.
  try {
    await syncProjects(token);
  } catch {
    // Best effort, as above.
  }

  let targets: FortnoxFinancialYear[];
  if (opts.financialYearId != null) {
    targets = years.filter((y) => y.id === opts.financialYearId);
  } else if (opts.scope === "current") {
    const containing = yearContaining(years);
    targets = containing ? [containing] : [];
  } else {
    targets = years;
  }

  const results: YearSyncResult[] = [];
  for (const y of targets) results.push(await syncYear(token, y.id));
  return { years: results, costCenters };
}

export interface SupplierSyncResult {
  suppliers: number;
}

// Keep the app's copy of the supplier register (lib/server/supplier-register).
// It is what a levfaktura's PDF is matched against at the fördelning, so it has
// to be current without anyone having opened the export picker first.
export async function syncSuppliers(token: string): Promise<SupplierSyncResult> {
  const suppliers = await listSuppliers(token);
  await rememberRegister(suppliers);
  return { suppliers: suppliers.length };
}

/** The financial year a date falls in, or the newest one Fortnox knows. */
export function yearContaining(
  years: readonly FortnoxFinancialYear[],
  date = new Date().toISOString().slice(0, 10),
): FortnoxFinancialYear | undefined {
  return years.find((y) => y.fromDate <= date && date <= y.toDate) ?? years[0];
}

/** One step of a full sync: what it did, or the error it stopped on. */
export type SyncStep<T> = { ok: true; result: T } | { ok: false; error: string };

export interface SyncAllResult {
  financialYears: SyncStep<{ years: number }>;
  costCenters: SyncStep<CostCenterSyncResult>;
  projects: SyncStep<ProjectSyncResult>;
  accounts: SyncStep<AccountSyncResult>;
  suppliers: SyncStep<SupplierSyncResult>;
  ledger: SyncStep<YearSyncResult>[];
}

/**
 * How long a sync may claim to be running before the claim is ignored. A
 * sync that crashed, or a pod that was killed mid-way, never clears it, and
 * without this the nightly job would stand aside for it forever. A whole run
 * is a few SIE files and some lists, so this is generous.
 */
const SYNC_STALE_MS = 30 * 60 * 1000;

const step = async <T>(run: () => Promise<T>): Promise<SyncStep<T>> => {
  try {
    return { ok: true, result: await run() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

/**
 * Everything the app mirrors from Fortnox, in one go: the nightly job
 * (api/cron/fortnox-sync) and "Synka allt nu" on the Fortnox settings page.
 * The page's other buttons still fetch one thing each.
 *
 * Each step on its own. A connection without the `project` scope, or a
 * supplier list Fortnox will not hand over, still leaves the ledger synced,
 * and the result says which step failed and why. Only the financial years are
 * needed by later steps, so failing to get them skips the accounts and the
 * ledger, and nothing else.
 *
 * The ledger is this financial year and the one before it. Vouchers keep
 * arriving in last year until its bokslut is done, and the app has nothing
 * that says when that is, so it is always fetched. Older years are closed,
 * and each has its own button on the settings page.
 *
 * Returns null, having done nothing, when another sync is already running.
 */
export async function syncAll(): Promise<SyncAllResult | null> {
  const startedAt = new Date();
  // The claim. Taken in one statement, so two syncs started at once cannot
  // both see the row free.
  const claimed = await prisma.$executeRaw`
    INSERT INTO "FortnoxSync" ("id", "runningSince", "lastStartedAt", "updatedAt")
    VALUES ('singleton', ${startedAt}, ${startedAt}, ${startedAt})
    ON CONFLICT ("id") DO UPDATE SET
      "runningSince" = EXCLUDED."runningSince",
      "lastStartedAt" = EXCLUDED."lastStartedAt",
      "updatedAt" = EXCLUDED."updatedAt"
    WHERE "FortnoxSync"."runningSince" IS NULL
       OR "FortnoxSync"."runningSince" < ${new Date(startedAt.getTime() - SYNC_STALE_MS)}`;
  if (claimed === 0) return null;

  let result: SyncAllResult | null = null;
  let failure: string | null = null;
  try {
    result = await runAll();
    failure = failedSteps(result);
  } catch (e) {
    // No token at all: not connected, or the connection is no longer valid.
    failure = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    await prisma.fortnoxSync.update({
      where: { id: "singleton" },
      data: {
        runningSince: null,
        lastFinishedAt: new Date(),
        lastResult: result ? (result as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        lastError: failure,
      },
    });
  }
  return result;
}

async function runAll(): Promise<SyncAllResult> {
  const token = await getServiceToken();

  const years = await step(() => syncFinancialYears(token));
  const costCenters = await step(() => syncCostCenters(token));
  const projects = await step(() => syncProjects(token));
  const suppliers = await step(() => syncSuppliers(token));

  const skipped = { ok: false as const, error: "fortnox.noFinancialYears" };
  if (!years.ok || years.result.length === 0) {
    return {
      financialYears: years.ok ? { ok: true, result: { years: 0 } } : years,
      costCenters,
      projects,
      accounts: skipped,
      suppliers,
      ledger: [skipped],
    };
  }

  const current = yearContaining(years.result)!;
  const accounts = await step(() => syncAccounts(token, current.id));

  // The year that ended right before this one, if Fortnox has it.
  const previous = years.result
    .filter((y) => y.toDate < current.fromDate)
    .sort((a, b) => b.toDate.localeCompare(a.toDate))[0];
  const ledger: SyncStep<YearSyncResult>[] = [];
  for (const y of previous ? [current, previous] : [current]) {
    ledger.push(await step(() => syncYear(token, y.id)));
  }

  return {
    financialYears: { ok: true, result: { years: years.result.length } },
    costCenters,
    projects,
    accounts,
    suppliers,
    ledger,
  };
}

/** The steps that failed, named, or null when none did. */
function failedSteps(r: SyncAllResult): string | null {
  const failed = [
    ...(["financialYears", "costCenters", "projects", "accounts", "suppliers"] as const).flatMap(
      (key) => {
        const s = r[key];
        return s.ok ? [] : [`${key}: ${s.error}`];
      },
    ),
    ...r.ledger.flatMap((s) => (s.ok ? [] : [`ledger: ${s.error}`])),
  ];
  return failed.length > 0 ? failed.join("; ") : null;
}
