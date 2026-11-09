// Pulls the Fortnox ledger into the local mirror via SIE, one whole financial year at a
// time: parse the year's SIE and replace its vouchers and rows in one transaction, so a
// sync is idempotent and needs no per-voucher fetching.
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
import { isoDay } from "@/lib/domain/date";
import { sekToOre } from "@/lib/domain/money";

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

// Rows per upsert statement. Postgres caps a statement at 65535 bound parameters.
const UPSERT_CHUNK = 500;

/** The rows of `list`, one per key, last one wins. A batch upsert fails on a repeated key (ON CONFLICT DO UPDATE). */
function lastByKey<T>(list: readonly T[], key: (item: T) => string): T[] {
  return [...new Map(list.map((item) => [key(item), item])).values()];
}

/** `($1,$2,$3),($4,$5,$6),…` for a multi-row VALUES plus its flat parameters. `casts` types columns Postgres cannot infer (enums). */
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
  madeLocal: number;
}

// Sync CostCenter from Fortnox: active ones become selectable, matched by code, keeping
// result unit + attestant. Archived ones are only deactivated. Ones Fortnox dropped are
// removed unless something local references them (expense allocation, verification line,
// budget sheet), in which case they are marked local (active left as is): Fortnox does
// not have the code, so the export must not send it (see lib/fortnox/export). Local cost
// centres are excluded here, or they would be retired on every sync.
export async function syncCostCenters(token: string): Promise<CostCenterSyncResult> {
  const fortnoxCcs = await listCostCenters(token);
  const seenCodes = new Set(fortnoxCcs.map((c) => c.code));

  // One statement per chunk. `id` is written only on insert so existing references hold.
  // Fortnox owns the row from here on: a local cost centre later created for real is
  // adopted (the code is unique).
  const now = new Date();
  for (const chunk of chunks(
    lastByKey(fortnoxCcs, (c) => c.code),
    UPSERT_CHUNK,
  )) {
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
      _count: {
        select: {
          allocations: true,
          verificationLines: true,
          budgetCostCenters: true,
          // Income references cost centres too, all SetNull: deleting would silently leave
          // lines without one and the next voucher would reach Fortnox without it.
          incomeUnits: true,
          incomePrefixes: true,
          incomeLines: true,
          incomeReports: true,
          zettleFeeSettings: true,
        },
      },
    },
  });
  const unreferencedIds = gone
    .filter((c) => Object.values(c._count).every((n) => n === 0))
    .map((c) => c.id);

  const { count: deleted } = await prisma.costCenter.deleteMany({
    where: { id: { in: unreferencedIds } },
  });

  const { count: madeLocal } = await prisma.costCenter.updateMany({
    where: {
      source: "FORTNOX",
      code: { notIn: [...seenCodes] },
      id: { notIn: unreferencedIds },
    },
    data: { source: "LOCAL" },
  });

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

// Accounts are upserted, never deleted: a budget line or exported verification may
// reference a retired account. Retired ones are marked inactive (hidden from pickers).
export async function syncAccounts(
  token: string,
  financialYearId: number,
): Promise<AccountSyncResult> {
  const accounts = await listAccounts(token, financialYearId);
  const now = new Date();

  for (const chunk of chunks(
    lastByKey(accounts, (a) => a.number),
    UPSERT_CHUNK,
  )) {
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

// Mirrors projects like accounts: upserted, never deleted, unlisted ones marked inactive.
export async function syncProjects(token: string): Promise<ProjectSyncResult> {
  const projects = await listProjects(token);
  const now = new Date();

  for (const chunk of chunks(
    lastByKey(projects, (p) => p.number),
    UPSERT_CHUNK,
  )) {
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

// Replace one financial year's ledger from its SIE export. The FortnoxFinancialYear row
// must exist (syncLedger upserts it first).
async function syncYear(token: string, fyId: number): Promise<YearSyncResult> {
  const parsed = parseSie(await fetchSie(token, fyId));

  const voucherRecords: Prisma.LedgerVoucherCreateManyInput[] = [];
  const rowRecords: Prisma.LedgerRowCreateManyInput[] = [];

  // #IB/#UB (and optional per-cost-centre #OIB/#OUB), one row per account+cost-centre key.
  const balanceRecords: Prisma.LedgerAccountBalanceCreateManyInput[] = [
    ...new Set([...parsed.openingBalances.keys(), ...parsed.closingBalances.keys()]),
  ].map((key) => {
    const [account, costCenterCode] = key.split("|");
    return {
      financialYear: fyId,
      account,
      accountName: parsed.accounts.get(account) ?? "",
      costCenterCode: costCenterCode ?? "",
      opening: sekToOre(parsed.openingBalances.get(key) ?? 0),
      closing: sekToOre(parsed.closingBalances.get(key) ?? 0),
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
        // Copied from the voucher to answer reports without a join. See LedgerRow in schema.prisma.
        financialYear: fyId,
        date,
        account: tr.account,
        accountName: parsed.accounts.get(tr.account) ?? "",
        costCenterCode: tr.costCenterCode ?? null,
        costCenterName: tr.costCenterCode
          ? (parsed.costCenters.get(tr.costCenterCode) ?? null)
          : null,
        text: tr.text ?? null,
        debit: tr.amount > 0 ? sekToOre(tr.amount) : 0,
        credit: tr.amount < 0 ? sekToOre(-tr.amount) : 0,
      });
    }
    voucherRecords.push({
      id: voucherId,
      financialYear: fyId,
      series: v.series,
      number: v.number,
      date,
      description: v.description,
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

// scope "current" syncs the year containing today, "all" every financial year, or pass
// `year` (Fortnox FY id) for one.
export async function syncLedger(opts: {
  scope: "current" | "all";
  /** Fortnox's id for one financial year, not a calendar year. */
  financialYearId?: number;
}): Promise<LedgerSyncResult> {
  const token = await getServiceToken();
  const years = await syncFinancialYears(token);

  // Best effort: needs the `costcenter` scope, which an older connection may lack.
  let costCenters: CostCenterSyncResult | undefined;
  try {
    costCenters = await syncCostCenters(token);
  } catch {
    costCenters = undefined;
  }
  try {
    await syncProjects(token);
  } catch {}

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

// Keep the supplier register copy current (lib/server/supplier-register), since a
// levfaktura PDF is matched against it at fördelning.
export async function syncSuppliers(token: string): Promise<SupplierSyncResult> {
  const suppliers = await listSuppliers(token);
  await rememberRegister(suppliers);
  return { suppliers: suppliers.length };
}

function yearContaining(
  years: readonly FortnoxFinancialYear[],
  date = isoDay(new Date()),
): FortnoxFinancialYear | undefined {
  return years.find((y) => y.fromDate <= date && date <= y.toDate) ?? years[0];
}

export type SyncStep<T> = { ok: true; result: T } | { ok: false; error: string };

export interface SyncAllResult {
  financialYears: SyncStep<{ years: number }>;
  costCenters: SyncStep<CostCenterSyncResult>;
  projects: SyncStep<ProjectSyncResult>;
  accounts: SyncStep<AccountSyncResult>;
  suppliers: SyncStep<SupplierSyncResult>;
  ledger: SyncStep<YearSyncResult>[];
}

/** How long a sync claim is honoured. A crashed sync never clears it, so older claims are ignored. */
const SYNC_STALE_MS = 30 * 60 * 1000;

const step = async <T>(run: () => Promise<T>): Promise<SyncStep<T>> => {
  try {
    return { ok: true, result: await run() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

/**
 * Everything mirrored from Fortnox: the nightly job (api/cron/fortnox-sync) and "Synka
 * allt nu". Each step is independent and the result says which failed. Only the financial
 * years are needed by later steps. The ledger is this year and the previous one (vouchers
 * keep arriving until its bokslut). Returns null if another sync is already running.
 */
export async function syncAll(): Promise<SyncAllResult | null> {
  const startedAt = new Date();
  // The claim, taken in one statement so two simultaneous syncs cannot both see it free.
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
