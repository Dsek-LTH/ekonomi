// What a stock's log comes to in the books, per day. Pure over plain data. See docs/stock.md.
//
// The log can be corrected and a correction reaches back, so a voucher is never "the day's movements" read
// once. It is what the log says now, less what was already sent for that day. A day that was never sent gets
// its own voucher on its own date. A day that was sent and has since changed is put right by a correction.

import type { StockEntryKind } from "@/lib/domain/types";

export type PostingClass = "PURCHASE" | "CONSUMPTION" | "BOARD" | "LOSS" | "COUNT";
export type PurchaseMode = "CAPITALISED" | "EXPENSED";

/**
 * Which class a movement is booked as, or null when it does not reach the books at all: a spill at a night
 * carries no value (the checkout took it), and a delivery to a stock whose purchases already debit the stock
 * account in Fortnox would be counted twice.
 */
export function classOf(kind: StockEntryKind, mode: PurchaseMode): PostingClass | null {
  switch (kind) {
    case "PURCHASE":
      return mode === "EXPENSED" ? "PURCHASE" : null;
    case "CHECKOUT":
    case "RETURN":
    case "ISSUE":
      return "CONSUMPTION";
    case "WITHDRAWAL":
      return "BOARD";
    case "SPOILAGE":
      return "LOSS";
    case "COUNT":
    case "CORRECTION":
      return "COUNT";
    case "WASTE":
      return null;
  }
}

/** An amount of value that moved, by the day it belongs to, why, which product type, and whose cost. */
export interface Bucket {
  /** `YYYY-MM-DD`. */
  date: string;
  class: PostingClass;
  groupId: string;
  costCenterId: string | null;
  /** Signed effect on the stock's value, in öre. Negative is value leaving. */
  amountOre: number;
}

const keyOf = (b: Omit<Bucket, "amountOre">): string =>
  `${b.date}|${b.class}|${b.groupId}|${b.costCenterId ?? ""}`;

/** Buckets added up per key, zeroes dropped, in date order. */
export function sumBuckets(buckets: readonly Bucket[]): Bucket[] {
  const by = new Map<string, Bucket>();
  for (const b of buckets) {
    const key = keyOf(b);
    const held = by.get(key);
    if (held) held.amountOre += b.amountOre;
    else by.set(key, { ...b });
  }
  return [...by.entries()]
    .filter(([, b]) => b.amountOre !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, b]) => b);
}

/** What is still to send: what the log says now, less what was sent, bucket by bucket. */
export function outstanding(expected: readonly Bucket[], posted: readonly Bucket[]): Bucket[] {
  return sumBuckets([...expected, ...posted.map((b) => ({ ...b, amountOre: -b.amountOre }))]);
}

export interface PostingPlan {
  /** Days after the last export with something to send, oldest first. A voucher takes all of them up to a date. */
  days: { date: string; buckets: Bucket[] }[];
  /** What has changed on days already sent. All of it goes in one correction voucher. */
  corrections: Bucket[];
}

/**
 * Split what is outstanding into unsent days and corrections. A voucher is exported through a chosen date and
 * takes every unsent day up to it, so everything on or before the last such date (`sentThrough`) has been sent:
 * what has changed there since is a correction, as is anything on a date Fortnox will no longer take (`open`).
 */
export function planPosting(
  due: readonly Bucket[],
  sentThrough: string | null,
  open: (date: string) => boolean = () => true,
): PostingPlan {
  const days = new Map<string, Bucket[]>();
  const corrections: Bucket[] = [];
  for (const b of due) {
    if ((sentThrough !== null && b.date <= sentThrough) || !open(b.date)) corrections.push(b);
    else days.set(b.date, [...(days.get(b.date) ?? []), b]);
  }
  return {
    days: [...days.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, buckets]) => ({ date, buckets })),
    corrections,
  };
}

/** Every unsent day up to and including `date`, as one voucher's buckets. */
export const bucketsThrough = (days: PostingPlan["days"], date: string): Bucket[] =>
  sumBuckets(days.filter((d) => d.date <= date).flatMap((d) => d.buckets));

/** The accounts a stock's vouchers are written on. Every one is somebody's choice (Inställningar, Lager). */
export interface PostingAccounts {
  purchaseOffsetAccount: string | null;
  boardCostAccount: string | null;
  groups: ReadonlyMap<
    string,
    {
      stockAccount: string | null;
      consumptionAccount: string | null;
      lossAccount: string | null;
      countDiffAccount: string | null;
    }
  >;
}

/** The account a class is charged on for one product type, or null where nobody has chosen it. */
export function classAccount(
  accounts: PostingAccounts,
  cls: PostingClass,
  groupId: string,
): string | null {
  const group = accounts.groups.get(groupId);
  switch (cls) {
    case "PURCHASE":
      return accounts.purchaseOffsetAccount;
    case "BOARD":
      return accounts.boardCostAccount;
    case "CONSUMPTION":
      return group?.consumptionAccount ?? null;
    // Spoilage and stocktake differences fall back to the type's cost account.
    case "LOSS":
      return group?.lossAccount ?? group?.consumptionAccount ?? null;
    case "COUNT":
      return group?.countDiffAccount ?? group?.consumptionAccount ?? null;
  }
}

/** One row of a voucher. One of debit and credit is zero. */
export interface VoucherLine {
  account: string;
  costCenterId: string | null;
  description: string | null;
  debit: number;
  credit: number;
}

export type VoucherLinesResult =
  | { ok: true; lines: VoucherLine[] }
  | { ok: false; missing: { class: PostingClass | "STOCK"; groupId: string } };

/**
 * The voucher rows for a set of buckets. Each bucket moves its amount between the product type's stock account
 * and the account of its class, and rows that share an account, a cost centre and a text are added together.
 * A stock account row carries no cost centre: it is a balance account.
 *
 * `describe` gives a bucket's row text, which is how a correction says which day it is for.
 */
export function voucherLines(
  buckets: readonly Bucket[],
  accounts: PostingAccounts,
  describe: (b: Bucket) => string | null = () => null,
): VoucherLinesResult {
  // Net debit per row key. Positive is a debit.
  const net = new Map<string, { line: Omit<VoucherLine, "debit" | "credit">; ore: number }>();
  const add = (
    account: string,
    costCenterId: string | null,
    description: string | null,
    ore: number,
  ) => {
    const key = `${account}|${costCenterId ?? ""}|${description ?? ""}`;
    const held = net.get(key);
    if (held) held.ore += ore;
    else net.set(key, { line: { account, costCenterId, description }, ore });
  };

  for (const b of buckets) {
    if (b.amountOre === 0) continue;
    const stockAccount = accounts.groups.get(b.groupId)?.stockAccount ?? null;
    if (!stockAccount) return { ok: false, missing: { class: "STOCK", groupId: b.groupId } };
    const other = classAccount(accounts, b.class, b.groupId);
    if (!other) return { ok: false, missing: { class: b.class, groupId: b.groupId } };
    const text = describe(b);
    // Value arriving debits the stock account, value leaving credits it. The class takes the other side.
    add(stockAccount, null, text, b.amountOre);
    add(other, b.costCenterId, text, -b.amountOre);
  }

  const lines = [...net.values()]
    .filter((n) => n.ore !== 0)
    .map(({ line, ore }) => ({
      ...line,
      debit: ore > 0 ? ore : 0,
      credit: ore < 0 ? -ore : 0,
    }))
    // Debits first, then by account: how a voucher is usually read.
    .sort(
      (a, b) => (b.debit > 0 ? 1 : 0) - (a.debit > 0 ? 1 : 0) || a.account.localeCompare(b.account),
    );
  return { ok: true, lines };
}

/** The net effect of a set of buckets on the stock's value. */
export const netOre = (buckets: readonly Bucket[]): number =>
  buckets.reduce((sum, b) => sum + b.amountOre, 0);

/**
 * A short fingerprint of what a voucher would say, so the export can refuse to send a figure nobody looked at:
 * the page shows it, the button sends it back, and the server compares it with what it computes then.
 */
export function fingerprint(buckets: readonly Bucket[]): string {
  const text = sumBuckets(buckets)
    .map((b) => `${keyOf(b)}=${b.amountOre}`)
    .join(";");
  // FNV-1a. Not a secret, only a way to notice a change.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
