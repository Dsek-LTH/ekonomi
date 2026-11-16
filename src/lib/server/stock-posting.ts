import "server-only";

// A stock's value in the books: what is due to be sent to Fortnox, and sending it. The arithmetic is
// lib/stock/posting.ts. This file reads the log and the memory of what was sent (StockPostingLine), freezes a
// voucher, and takes it through the same lock an utlägg's export has. See docs/stock.md.

import { Prisma } from "@/lib/generated/prisma/client";
import { isoDay, today } from "@/lib/domain/date";
import type { StockEntryKind } from "@/lib/domain/types";
import {
  createVoucher,
  financialYearsFor,
  FortnoxError,
  getConnection,
  getServiceToken,
  listFinancialYears,
  listVouchers,
} from "@/lib/fortnox";
import { voucherRows } from "@/lib/fortnox/export";
import { getStockSettings, type StockSettingsView } from "@/lib/data/stock-settings";
import {
  bucketsThrough,
  classOf,
  fingerprint,
  netOre,
  outstanding,
  planPosting,
  sumBuckets,
  voucherLines,
  type Bucket,
  type PostingAccounts,
  type PostingClass,
  type VoucherLine,
} from "@/lib/stock/posting";
import type { StockSetupGap } from "@/lib/stock/setup";
import type { StockSlug } from "@/lib/stock/stocks";
import { prisma } from "./db";
import type { TxClient } from "./tx";

type Db = TxClient | typeof prisma;

/** How long a voucher may sit frozen and unsent before the next attempt takes it over. Nothing was asked of Fortnox. */
const CLAIM_ABANDONED_MS = 2 * 60_000;

const STOCK_NAME: Record<StockSlug, string> = { alcohol: "Alkohol", cafe: "Café" };

/** The voucher text. Also what the duplicate check looks for in Fortnox, so it is made in one place. */
export function stockVoucherText(
  stock: StockSlug,
  kind: "DAILY" | "CORRECTION" | "RECONCILIATION",
  date: string,
  sequence = 0,
): string {
  const base = `Lager ${STOCK_NAME[stock]}`;
  // A voucher takes every unsent day up to its date, so it says "through".
  if (kind === "DAILY") return `${base} t.o.m. ${date}`;
  const word = kind === "CORRECTION" ? "rättelse" : "avstämning";
  return `${base} ${word} ${date}${sequence > 0 ? ` nr ${sequence + 1}` : ""}`;
}

// ── Reading ──────────────────────────────────────────────────────

/** A voucher row as the page shows it and the export writes it. */
export interface PostingLineView extends VoucherLine {
  accountName: string;
  costCenterCode: string | null;
}

export interface PostingPart {
  buckets: Bucket[];
  /** Null where an account is still to be chosen: the page says so and nothing can be sent. */
  lines: PostingLineView[] | null;
  /** Net effect on the stock's value, in öre. */
  netOre: number;
  fingerprint: string;
}

export interface PostingDay extends PostingPart {
  date: string;
}

/** Why no voucher can be made through a chosen date. */
export type ThroughRefusal = "alreadySent" | "closedPeriod" | "nothingToSend";

/** A voucher that is neither safely unsent nor known to be in Fortnox. It blocks the stock until settled. */
export interface PostingInFlight {
  id: string;
  kind: "DAILY" | "CORRECTION" | "RECONCILIATION";
  date: string;
  state: "CLAIMED" | "SENT" | "UNCERTAIN";
  by: string | null;
}

export interface PostingView {
  stock: StockSlug;
  settings: StockSettingsView;
  gaps: StockSetupGap[];
  /** The first and last day in play, or null while posting is off. */
  startsOn: string | null;
  through: string;
  /** The date the last voucher was exported through. Everything on or before it has been sent. */
  sentThrough: string | null;
  /** Days with something unsent, oldest first. */
  days: PostingDay[];
  /** The voucher for the chosen date (every unsent day up to it), when one was asked for and can be made. */
  voucher: PostingDay | null;
  /** Why it cannot, when one was asked for and cannot. */
  voucherRefusal: ThroughRefusal | null;
  /** What has changed on days already sent, or null when nothing has. */
  corrections: PostingPart | null;
  inFlight: PostingInFlight[];
}

/** Every movement of value from the day posting starts, added up per day, kind, product type and night's cost centre. */
async function expectedBuckets(
  db: Db,
  settings: StockSettingsView,
  from: string,
  through: string,
): Promise<Bucket[]> {
  const rows = await db.$queryRaw<
    {
      day: Date;
      kind: StockEntryKind;
      groupId: string;
      costCenterId: string | null;
      ore: bigint;
    }[]
  >(Prisma.sql`
    SELECT e."occurredAt" AS "day", e."kind", p."groupId",
           COALESCE(ev."costCenterId", pl."costCenterId") AS "costCenterId",
           SUM(e."valueDeltaOre") AS "ore"
    FROM "StockEntry" e
    JOIN "StockProduct" p ON p."id" = e."productId"
    LEFT JOIN "StockEvent" ev ON ev."id" = e."eventId"
    LEFT JOIN "StockPlace" pl ON pl."id" = e."placeId"
    WHERE p."stockId" = ${settings.stock}
      AND e."occurredAt" >= ${new Date(from)}
      AND e."occurredAt" <= ${new Date(through)}
    GROUP BY 1, 2, 3, 4`);

  // Where a movement names no cost centre of its own, its class's setting on the stock.
  const fallback: Record<PostingClass, string | null> = {
    PURCHASE: settings.purchaseCostCenterId,
    CONSUMPTION: settings.consumptionCostCenterId,
    BOARD: settings.boardCostCenterId,
    LOSS: settings.lossCostCenterId,
    COUNT: settings.countDiffCostCenterId,
  };

  return sumBuckets(
    rows.flatMap((r) => {
      const cls = classOf(r.kind, settings.purchaseMode);
      if (!cls) return [];
      return [
        {
          date: isoDay(r.day),
          class: cls,
          groupId: r.groupId,
          // Only consumption follows its night or its place. Everything else is the stock's own.
          costCenterId: (cls === "CONSUMPTION" ? r.costCenterId : null) ?? fallback[cls],
          amountOre: Number(r.ore),
        },
      ];
    }),
  );
}

/** What has been sent, or may have been: vouchers in Fortnox, and vouchers whose request left with no clear answer. */
async function postedBuckets(
  db: Db,
  stock: StockSlug,
): Promise<{ posted: Bucket[]; sentThrough: string | null }> {
  const vouchers = await db.stockVoucher.findMany({
    where: {
      stockId: stock,
      OR: [
        { verification: { exportedAt: { not: null } } },
        { exportClaimState: { in: ["SENT", "UNCERTAIN"] } },
      ],
    },
    select: { kind: true, date: true, lines: true },
  });
  return {
    posted: vouchers.flatMap((v) =>
      v.lines.map((l) => ({
        date: isoDay(l.forDate),
        class: l.class,
        groupId: l.groupId,
        costCenterId: l.costCenterId,
        amountOre: l.amountOre,
      })),
    ),
    // A voucher covers every day up to its date, so the latest one is how far the stock has been sent.
    sentThrough:
      vouchers
        .filter((v) => v.kind === "DAILY")
        .map((v) => isoDay(v.date))
        .sort()
        .at(-1) ?? null,
  };
}

const accountsOf = (settings: StockSettingsView): PostingAccounts => ({
  purchaseOffsetAccount: settings.purchaseOffsetAccount,
  boardCostAccount: settings.boardCostAccount,
  groups: new Map(settings.groups.map((g) => [g.id, g])),
});

/** Names for the accounts and cost centres a set of lines mentions, in two queries. */
async function decorate(
  db: Db,
  parts: (VoucherLine[] | null)[],
): Promise<(PostingLineView[] | null)[]> {
  const all = parts.flatMap((p) => p ?? []);
  const [accounts, centres] = await Promise.all([
    db.account.findMany({
      where: { number: { in: [...new Set(all.map((l) => l.account))] } },
      select: { number: true, name: true },
    }),
    db.costCenter.findMany({
      where: {
        id: { in: [...new Set(all.flatMap((l) => (l.costCenterId ? [l.costCenterId] : [])))] },
      },
      select: { id: true, code: true },
    }),
  ]);
  const name = new Map(accounts.map((a) => [a.number, a.name]));
  const code = new Map(centres.map((c) => [c.id, c.code]));
  return parts.map(
    (lines) =>
      lines?.map((l) => ({
        ...l,
        accountName: name.get(l.account) ?? "",
        costCenterCode: l.costCenterId ? (code.get(l.costCenterId) ?? null) : null,
      })) ?? null,
  );
}

/**
 * Everything the stock's Bokföring page shows, and what the export recomputes before it sends. `voucherThrough`
 * asks for the voucher that would be exported through that date: every unsent day up to it, as one voucher.
 */
export async function loadPosting(
  stock: StockSlug,
  db: Db = prisma,
  voucherThrough?: string,
): Promise<PostingView> {
  const settings = await getStockSettings(stock);
  // Today counts: a night's returns are often in by the evening, and nothing is sent unless somebody asks.
  const through = today();
  const startsOn = settings.postingStartsOn;

  const inFlightRows = await db.stockVoucher.findMany({
    where: { stockId: stock, exportClaimState: { not: null } },
    select: {
      id: true,
      kind: true,
      date: true,
      exportClaimState: true,
      exportClaimedAt: true,
      exportClaimedBy: { select: { name: true } },
    },
  });
  const now = Date.now();
  const inFlight: PostingInFlight[] = inFlightRows
    // A voucher frozen and never sent is taken over by the next attempt, so after a while it blocks nothing.
    .filter(
      (v) =>
        v.exportClaimState !== "CLAIMED" ||
        now - (v.exportClaimedAt?.getTime() ?? 0) < CLAIM_ABANDONED_MS,
    )
    .map((v) => ({
      id: v.id,
      kind: v.kind,
      date: isoDay(v.date),
      state: v.exportClaimState!,
      by: v.exportClaimedBy?.name ?? null,
    }));

  const empty = { days: [], corrections: null, voucher: null, sentThrough: null };
  const base = { stock, settings, gaps: settings.gaps, startsOn, through, inFlight };
  if (!startsOn || startsOn > through) {
    return { ...base, ...empty, voucherRefusal: voucherThrough ? "nothingToSend" : null };
  }

  const [expected, { posted, sentThrough }, years] = await Promise.all([
    expectedBuckets(db, settings, startsOn, through),
    postedBuckets(db, stock),
    db.fortnoxFinancialYear.findMany({ select: { fromDate: true, toDate: true } }),
  ]);
  // A date Fortnox has no financial year for cannot carry a voucher. Its movements go as a correction.
  const open = (date: string) =>
    years.length === 0 || years.some((y) => isoDay(y.fromDate) <= date && date <= isoDay(y.toDate));

  const plan = planPosting(outstanding(expected, posted), sentThrough, open);

  // The voucher asked for: refused on or before the last export (that is a correction now), on a date Fortnox has
  // no open year for, or where nothing is unsent up to it.
  let wanted: Bucket[] | null = null;
  let voucherRefusal: ThroughRefusal | null = null;
  if (voucherThrough) {
    if (sentThrough && voucherThrough <= sentThrough) voucherRefusal = "alreadySent";
    else if (!open(voucherThrough)) voucherRefusal = "closedPeriod";
    else {
      wanted = bucketsThrough(plan.days, voucherThrough);
      if (wanted.length === 0) voucherRefusal = "nothingToSend";
    }
  }
  const accounts = accountsOf(settings);
  const lines = (buckets: Bucket[], correction: boolean): VoucherLine[] | null => {
    const made = voucherLines(
      buckets,
      accounts,
      correction ? (b) => `Rättelse ${b.date}` : undefined,
    );
    return made.ok ? made.lines : null;
  };

  const raw = [
    ...plan.days.map((d) => lines(d.buckets, false)),
    plan.corrections.length > 0 ? lines(plan.corrections, true) : null,
    wanted && wanted.length > 0 ? lines(wanted, false) : null,
  ];
  const named = await decorate(db, raw);

  return {
    ...base,
    sentThrough,
    voucherRefusal,
    voucher:
      wanted && wanted.length > 0 && voucherThrough
        ? {
            date: voucherThrough,
            buckets: wanted,
            lines: named[named.length - 1],
            netOre: netOre(wanted),
            fingerprint: fingerprint(wanted),
          }
        : null,
    days: plan.days.map((d, i) => ({
      date: d.date,
      buckets: d.buckets,
      lines: named[i],
      netOre: netOre(d.buckets),
      fingerprint: fingerprint(d.buckets),
    })),
    corrections:
      plan.corrections.length > 0
        ? {
            buckets: plan.corrections,
            lines: named[named.length - 2],
            netOre: netOre(plan.corrections),
            fingerprint: fingerprint(plan.corrections),
          }
        : null,
  };
}

// ── Sending ──────────────────────────────────────────────────────

export type ExportOutcome =
  | { ok: true; voucherId: string; label: string; adopted: boolean }
  | { ok: false; status: number; error: string; values?: Record<string, string | number> };

type Refusal = Extract<ExportOutcome, { ok: false }>;

const refuse = (
  status: number,
  error: string,
  values?: Record<string, string | number>,
): Refusal => ({
  ok: false,
  status,
  error,
  values,
});

/** What to send: every unsent day through a date, or the corrections. */
export type ExportTarget = { kind: "DAILY"; date: string } | { kind: "CORRECTION" };

/** The series a stock's vouchers land in, or null when none has been chosen anywhere. */
export async function stockVoucherSeries(settings: StockSettingsView): Promise<string | null> {
  if (settings.voucherSeries) return settings.voucherSeries;
  return (await getConnection())?.voucherSeries ?? null;
}

/**
 * Freeze the voucher: written down with its posting lines and its rows, and locked, in one transaction that holds
 * the stock's row so two bookkeepers cannot freeze the same day. Nothing has been asked of Fortnox yet.
 */
async function freeze(
  stock: StockSlug,
  target: ExportTarget,
  seen: string,
  actorId: string,
): Promise<
  | { ok: true; voucherId: string; verificationId: string; date: string; text: string; claim: Date }
  | Extract<ExportOutcome, { ok: false }>
> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Stock" WHERE "id" = ${stock} FOR UPDATE`;

      // Frozen and never sent: nothing reached Fortnox, so it is simply dropped and made again.
      await tx.stockVoucher.deleteMany({
        where: {
          stockId: stock,
          exportClaimState: "CLAIMED",
          exportClaimedAt: { lt: new Date(Date.now() - CLAIM_ABANDONED_MS) },
        },
      });

      const view = await loadPosting(stock, tx, target.kind === "DAILY" ? target.date : undefined);
      if (view.gaps.length > 0) return refuse(409, "stockVoucher.notSetUp");
      if (view.inFlight.length > 0) {
        const held = view.inFlight[0];
        return refuse(
          409,
          held.state === "UNCERTAIN" ? "stockVoucher.uncertainFirst" : "stockVoucher.inProgress",
          { date: held.date, name: held.by ?? "-" },
        );
      }

      let part: PostingPart | undefined;
      let date: string;
      if (target.kind === "DAILY") {
        if (view.voucherRefusal) {
          // "Already booked through" names how far, not the date asked for.
          const shown = view.voucherRefusal === "alreadySent" ? view.sentThrough : null;
          return refuse(409, `stockVoucher.${view.voucherRefusal}`, {
            date: shown ?? target.date,
          });
        }
        part = view.voucher ?? undefined;
        date = target.date;
      } else {
        part = view.corrections ?? undefined;
        // Dated the day it was found. A correction never reaches back into a period that may be closed.
        date = today();
      }
      if (!part) return refuse(409, "stockVoucher.nothingToSend");
      if (!part.lines) return refuse(409, "stockVoucher.notSetUp");
      // The figure moved since the page was drawn. Nobody sends a voucher they did not look at.
      if (part.fingerprint !== seen) return refuse(409, "stockVoucher.changed");

      const last = await tx.stockVoucher.aggregate({
        where: { stockId: stock, date: new Date(date), kind: target.kind },
        _max: { sequence: true },
      });
      const sequence = last._max.sequence == null ? 0 : last._max.sequence + 1;
      if (target.kind === "DAILY" && sequence > 0) {
        return refuse(409, "stockVoucher.alreadySent", { date });
      }

      const value = await tx.stockEntry.aggregate({
        where: { product: { stockId: stock }, occurredAt: { lte: new Date(date) } },
        _sum: { valueDeltaOre: true },
      });
      const text = stockVoucherText(stock, target.kind, date, sequence);
      const claim = new Date();
      const voucher = await tx.stockVoucher.create({
        data: {
          stockId: stock,
          date: new Date(date),
          kind: target.kind,
          sequence,
          valueAfterOre: value._sum.valueDeltaOre ?? 0,
          createdById: actorId,
          exportClaimedById: actorId,
          exportClaimedAt: claim,
          exportClaimState: "CLAIMED",
          lines: {
            create: part.buckets.map((b) => ({
              forDate: new Date(b.date),
              class: b.class,
              groupId: b.groupId,
              costCenterId: b.costCenterId,
              amountOre: b.amountOre,
            })),
          },
          verification: {
            create: {
              date: new Date(date),
              description: text,
              createdById: actorId,
              lines: {
                create: part.lines.map((l, i) => ({
                  account: l.account,
                  accountName: l.accountName,
                  description: l.description,
                  costCenterId: l.costCenterId,
                  debit: l.debit,
                  credit: l.credit,
                  sortOrder: i,
                })),
              },
            },
          },
        },
        select: { id: true, verification: { select: { id: true } } },
      });
      return {
        ok: true,
        voucherId: voucher.id,
        verificationId: voucher.verification!.id,
        date,
        text,
        claim,
      };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/** A voucher in Fortnox with exactly this series, date and text, read with the service token. Throws when Fortnox cannot be asked. */
async function findInFortnox(series: string, date: string, text: string) {
  const token = await getServiceToken();
  const years = financialYearsFor(await listFinancialYears(token), date, date);
  const queries =
    years.length > 0
      ? years.map((y) => ({ from: date, to: date, financialYearId: y.id }))
      : [{ from: date, to: date }];
  for (const query of queries) {
    for (const v of await listVouchers(token, query)) {
      if (v.series === series && v.date === date && v.description.trim() === text) return v;
    }
  }
  return null;
}

/** Write the Fortnox number on the voucher and let go of the lock, in one transaction. */
async function recordSent(
  voucherId: string,
  verificationId: string,
  created: { series: string; number: number; year: number | null },
): Promise<void> {
  await prisma.$transaction([
    prisma.verification.update({
      where: { id: verificationId },
      data: {
        fortnoxSeries: created.series,
        fortnoxNumber: created.number,
        fortnoxYear: created.year,
        exportedAt: new Date(),
      },
    }),
    prisma.stockVoucher.update({
      where: { id: voucherId },
      data: { exportClaimedById: null, exportClaimedAt: null, exportClaimState: null },
    }),
  ]);
}

/**
 * Send one voucher to Fortnox with the bookkeeper's own token. `seen` is the fingerprint the page showed.
 *
 * Three things keep a day from being booked twice: the unique index on (stock, date, kind), the lock, and a look
 * in Fortnox for the same series, date and text before anything is sent. And one makes a slip harmless: a voucher
 * is what the log says less what was sent, so a second run for a sent day computes nothing.
 */
export async function exportStockVoucher(
  stock: StockSlug,
  target: ExportTarget,
  seen: string,
  actorId: string,
  token: string,
): Promise<ExportOutcome> {
  const settings = await getStockSettings(stock);
  const series = await stockVoucherSeries(settings);
  if (!series) return refuse(409, "settings.voucherSeriesUnset");

  const frozen = await freeze(stock, target, seen, actorId);
  if (!frozen.ok) return frozen;
  const { voucherId, verificationId, date, text, claim } = frozen;
  const drop = () =>
    prisma.stockVoucher.deleteMany({ where: { id: voucherId, exportClaimedAt: claim } });

  // Already there, from a run whose answer was lost: take its number and send nothing.
  let existing;
  try {
    existing = await findInFortnox(series, date, text);
  } catch (e) {
    await drop();
    console.error(`[stock] ${stock} ${date}: could not look for the voucher in Fortnox`, e);
    return refuse(502, "stockVoucher.duplicateCheckFailed");
  }
  if (existing) {
    await recordSent(voucherId, verificationId, existing);
    return { ok: true, voucherId, label: `${existing.series}-${existing.number}`, adopted: true };
  }

  const verification = await prisma.verification.findUniqueOrThrow({
    where: { id: verificationId },
    include: { lines: { orderBy: { sortOrder: "asc" }, include: { costCenter: true } } },
  });

  // Said, and committed, before Fortnox is asked. From here the voucher may exist.
  const sent = await prisma.stockVoucher.updateMany({
    where: { id: voucherId, exportClaimedAt: claim, exportClaimState: "CLAIMED" },
    data: { exportClaimState: "SENT" },
  });
  if (sent.count !== 1) return refuse(409, "stockVoucher.inProgress", { date, name: "-" });

  let created;
  try {
    created = await createVoucher(token, {
      series,
      date,
      description: text,
      rows: voucherRows(verification.lines),
    });
  } catch (e) {
    // A plain refusal (a locked period, a retired cost centre) made no voucher: the day is free again.
    if (e instanceof FortnoxError && e.status != null && e.status >= 400 && e.status < 500) {
      await prisma.stockVoucher.deleteMany({ where: { id: voucherId, exportClaimedAt: claim } });
      return refuse(e.status, e.message);
    }
    // No clear answer. Kept, and flagged, until somebody looks in Fortnox.
    await prisma.stockVoucher.updateMany({
      where: { id: voucherId, exportClaimedAt: claim },
      data: { exportClaimState: "UNCERTAIN" },
    });
    console.error(
      `[stock] ${stock} ${date}: the voucher request came back with no clear answer`,
      e,
    );
    return refuse(502, "stockVoucher.uncertain", { date });
  }

  await recordSent(voucherId, verificationId, created);
  return { ok: true, voucherId, label: `${created.series}-${created.number}`, adopted: false };
}

/**
 * Settle a voucher whose request left with no clear answer: look in Fortnox for it. Found, it takes that number.
 * Not found, it is dropped and the day is computed again.
 */
export async function resolveStockVoucher(
  voucherId: string,
): Promise<ExportOutcome | { ok: true; released: true; date: string }> {
  const voucher = await prisma.stockVoucher.findUnique({
    where: { id: voucherId },
    include: { verification: true },
  });
  if (!voucher || !voucher.verification) return refuse(404, "stockVoucher.notFound");
  if (voucher.exportClaimState == null) return refuse(409, "stockVoucher.alreadySent");

  const settings = await getStockSettings(voucher.stockId as StockSlug);
  // The series it was sent in is the one in force when it was sent, which is what the setting still says
  // unless somebody changed it in between. Both are looked in.
  const series = await stockVoucherSeries(settings);
  if (!series) return refuse(409, "settings.voucherSeriesUnset");

  const date = isoDay(voucher.date);
  let existing;
  try {
    existing = await findInFortnox(series, date, voucher.verification.description);
  } catch {
    return refuse(502, "stockVoucher.duplicateCheckFailed");
  }
  if (existing) {
    await recordSent(voucher.id, voucher.verification.id, existing);
    return { ok: true, voucherId, label: `${existing.series}-${existing.number}`, adopted: true };
  }
  await prisma.stockVoucher.delete({ where: { id: voucher.id } });
  return { ok: true, released: true, date };
}

/**
 * Forget that a voucher was sent, after it has been voided in Fortnox by hand. Only our record goes: its posting
 * lines no longer count as sent, so the day is due again.
 */
export async function unexportStockVoucher(voucherId: string): Promise<boolean> {
  const gone = await prisma.stockVoucher.deleteMany({
    where: { id: voucherId, exportClaimState: null, verification: { exportedAt: { not: null } } },
  });
  return gone.count === 1;
}

// ── What was sent ────────────────────────────────────────────────

export interface SentVoucherDto {
  id: string;
  kind: "DAILY" | "CORRECTION" | "RECONCILIATION";
  date: string;
  description: string;
  /** "A-142", once it is in Fortnox. */
  label: string | null;
  netOre: number;
  valueAfterOre: number;
  exportedAt: string | null;
  by: string | null;
}

/** The vouchers made for a stock, newest first. */
export async function getSentVouchers(
  stock: StockSlug,
  range: { from?: string; to?: string } = {},
): Promise<SentVoucherDto[]> {
  const rows = await prisma.stockVoucher.findMany({
    where: {
      stockId: stock,
      verification: { exportedAt: { not: null } },
      date: {
        gte: range.from ? new Date(range.from) : undefined,
        lte: range.to ? new Date(range.to) : undefined,
      },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 500,
    include: {
      verification: { include: { lines: true } },
      lines: { select: { amountOre: true } },
      createdBy: { select: { name: true } },
    },
  });
  return rows.map((v) => ({
    id: v.id,
    kind: v.kind,
    date: isoDay(v.date),
    description: v.verification?.description ?? "",
    label:
      v.verification?.fortnoxSeries && v.verification.fortnoxNumber != null
        ? `${v.verification.fortnoxSeries}-${v.verification.fortnoxNumber}`
        : null,
    netOre: v.lines.reduce((sum, l) => sum + l.amountOre, 0),
    valueAfterOre: v.valueAfterOre,
    exportedAt: v.verification?.exportedAt?.toISOString() ?? null,
    by: v.createdBy.name,
  }));
}

// ── Reconciliation ───────────────────────────────────────────────

/** One stock account: what the log says it should hold in Fortnox, and what the ledger mirror says it holds. */
export interface ReconciliationRow {
  groupId: string;
  name: string;
  stockAccount: string | null;
  /** The log's value of this type's products, today. */
  appValueOre: number;
  /** What is still to send that will move this account. */
  dueOre: number;
  /** What Fortnox should show: the log's value less what has not been sent yet. */
  expectedOre: number;
  /** The balance in the ledger mirror, or null when the account is not in it. */
  fortnoxOre: number | null;
  /** Fortnox less expected. Zero is agreement. */
  diffOre: number | null;
}

export interface Reconciliation {
  rows: ReconciliationRow[];
  /** When the ledger was last read from Fortnox. A voucher sent after it is not in `fortnoxOre` yet. */
  ledgerSyncedAt: string | null;
  /** A voucher was sent after the last sync, so the difference shown is out of date. */
  stale: boolean;
}

export async function getReconciliation(stock: StockSlug): Promise<Reconciliation> {
  const settings = await getStockSettings(stock);
  const day = today();

  const [values, year, lastSent] = await Promise.all([
    prisma.$queryRaw<{ groupId: string; ore: bigint }[]>(Prisma.sql`
      SELECT p."groupId", COALESCE(SUM(e."valueDeltaOre"), 0) AS "ore"
      FROM "StockProduct" p LEFT JOIN "StockEntry" e ON e."productId" = p."id"
      WHERE p."stockId" = ${stock}
      GROUP BY 1`),
    prisma.fortnoxFinancialYear.findFirst({
      where: { fromDate: { lte: new Date(day) }, toDate: { gte: new Date(day) } },
      select: { id: true, lastSyncAt: true },
    }),
    prisma.verification.aggregate({
      where: { stockVoucher: { stockId: stock }, exportedAt: { not: null } },
      _max: { exportedAt: true },
    }),
  ]);

  // Everything not yet sent, today included: the page compares with what Fortnox holds right now.
  const due = new Map<string, number>();
  if (settings.postingStartsOn && settings.postingStartsOn <= day) {
    const [expected, { posted }] = await Promise.all([
      expectedBuckets(prisma, settings, settings.postingStartsOn, day),
      postedBuckets(prisma, stock),
    ]);
    for (const b of outstanding(expected, posted)) {
      due.set(b.groupId, (due.get(b.groupId) ?? 0) + b.amountOre);
    }
  }

  const accounts = settings.groups.flatMap((g) => (g.stockAccount ? [g.stockAccount] : []));
  const balances =
    year && accounts.length > 0
      ? await prisma.ledgerAccountBalance.findMany({
          // The row with no cost centre is the account's own total.
          where: { financialYear: year.id, account: { in: accounts }, costCenterCode: "" },
          select: { account: true, closing: true },
        })
      : [];
  const balance = new Map(balances.map((b) => [b.account, b.closing]));
  const value = new Map(values.map((v) => [v.groupId, Number(v.ore)]));

  // Two types on one account share its balance, so they are compared together, on the first of them.
  const shared = new Map<string, number>();
  for (const g of settings.groups) {
    if (!g.stockAccount) continue;
    const expected = (value.get(g.id) ?? 0) - (due.get(g.id) ?? 0);
    shared.set(g.stockAccount, (shared.get(g.stockAccount) ?? 0) + expected);
  }
  const shown = new Set<string>();

  const rows = settings.groups.map((g): ReconciliationRow => {
    const appValueOre = value.get(g.id) ?? 0;
    const dueOre = due.get(g.id) ?? 0;
    const first = g.stockAccount != null && !shown.has(g.stockAccount);
    if (g.stockAccount) shown.add(g.stockAccount);
    const fortnoxOre = g.stockAccount && first && year ? (balance.get(g.stockAccount) ?? 0) : null;
    return {
      groupId: g.id,
      name: g.name,
      stockAccount: g.stockAccount,
      appValueOre,
      dueOre,
      expectedOre: appValueOre - dueOre,
      fortnoxOre,
      diffOre: fortnoxOre == null ? null : fortnoxOre - (shared.get(g.stockAccount!) ?? 0),
    };
  });

  const syncedAt = year?.lastSyncAt ?? null;
  return {
    rows,
    ledgerSyncedAt: syncedAt?.toISOString() ?? null,
    stale:
      lastSent._max.exportedAt != null && (syncedAt == null || lastSent._max.exportedAt > syncedAt),
  };
}

/**
 * Bring the stock accounts in Fortnox to the log's value: one voucher dated `date`, a row pair per account that
 * differs, against that type's stocktake difference account. This is the opening when posting starts and the
 * year-end reconciliation. It carries no posting lines, because it is not a movement of the log.
 */
export async function exportReconciliation(
  stock: StockSlug,
  date: string,
  actorId: string,
  token: string,
): Promise<ExportOutcome> {
  const settings = await getStockSettings(stock);
  const series = await stockVoucherSeries(settings);
  if (!series) return refuse(409, "settings.voucherSeriesUnset");

  const recon = await getReconciliation(stock);
  // The difference is read off the ledger mirror. After a voucher it is wrong until the mirror is read again.
  if (recon.stale) return refuse(409, "stockVoucher.syncLedgerFirst");
  const view = await loadPosting(stock);
  if (view.inFlight.length > 0)
    return refuse(409, "stockVoucher.uncertainFirst", { date: view.inFlight[0].date, name: "-" });

  const groups = new Map(settings.groups.map((g) => [g.id, g]));
  const net = new Map<string, { account: string; costCenterId: string | null; ore: number }>();
  const add = (account: string, costCenterId: string | null, ore: number) => {
    const key = `${account}|${costCenterId ?? ""}`;
    const held = net.get(key);
    if (held) held.ore += ore;
    else net.set(key, { account, costCenterId, ore });
  };
  for (const row of recon.rows) {
    if (!row.diffOre) continue;
    const group = groups.get(row.groupId)!;
    const other = group.countDiffAccount ?? group.consumptionAccount;
    if (!row.stockAccount || !other) return refuse(409, "stockVoucher.notSetUp");
    // Fortnox holds `diff` too much: credit the stock account, charge the difference.
    add(row.stockAccount, null, -row.diffOre);
    add(other, settings.countDiffCostCenterId, row.diffOre);
  }
  const rows = [...net.values()].filter((r) => r.ore !== 0);
  if (rows.length === 0) return refuse(409, "stockVoucher.nothingToSend");

  const names = new Map(
    (
      await prisma.account.findMany({
        where: { number: { in: rows.map((r) => r.account) } },
        select: { number: true, name: true },
      })
    ).map((a) => [a.number, a.name]),
  );

  const frozen = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Stock" WHERE "id" = ${stock} FOR UPDATE`;
    const last = await tx.stockVoucher.aggregate({
      where: { stockId: stock, date: new Date(date), kind: "RECONCILIATION" },
      _max: { sequence: true },
    });
    const sequence = last._max.sequence == null ? 0 : last._max.sequence + 1;
    const value = await tx.stockEntry.aggregate({
      where: { product: { stockId: stock }, occurredAt: { lte: new Date(date) } },
      _sum: { valueDeltaOre: true },
    });
    const text = stockVoucherText(stock, "RECONCILIATION", date, sequence);
    const claim = new Date();
    const voucher = await tx.stockVoucher.create({
      data: {
        stockId: stock,
        date: new Date(date),
        kind: "RECONCILIATION",
        sequence,
        valueAfterOre: value._sum.valueDeltaOre ?? 0,
        createdById: actorId,
        exportClaimedById: actorId,
        exportClaimedAt: claim,
        exportClaimState: "SENT",
        verification: {
          create: {
            date: new Date(date),
            description: text,
            createdById: actorId,
            lines: {
              create: rows.map((r, i) => ({
                account: r.account,
                accountName: names.get(r.account) ?? "",
                costCenterId: r.costCenterId,
                debit: r.ore > 0 ? r.ore : 0,
                credit: r.ore < 0 ? -r.ore : 0,
                sortOrder: i,
              })),
            },
          },
        },
      },
      select: {
        id: true,
        verification: {
          select: {
            id: true,
            lines: { orderBy: { sortOrder: "asc" }, include: { costCenter: true } },
          },
        },
      },
    });
    return { voucher, text, claim };
  });

  const { voucher, text, claim } = frozen;
  let created;
  try {
    created = await createVoucher(token, {
      series,
      date,
      description: text,
      rows: voucherRows(voucher.verification!.lines),
    });
  } catch (e) {
    if (e instanceof FortnoxError && e.status != null && e.status >= 400 && e.status < 500) {
      await prisma.stockVoucher.deleteMany({ where: { id: voucher.id, exportClaimedAt: claim } });
      return refuse(e.status, e.message);
    }
    await prisma.stockVoucher.updateMany({
      where: { id: voucher.id, exportClaimedAt: claim },
      data: { exportClaimState: "UNCERTAIN" },
    });
    return refuse(502, "stockVoucher.uncertain", { date });
  }
  await recordSent(voucher.id, voucher.verification!.id, created);
  return {
    ok: true,
    voucherId: voucher.id,
    label: `${created.series}-${created.number}`,
    adopted: false,
  };
}
