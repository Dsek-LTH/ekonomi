import "server-only";

// The board's tab, read: the price list, what each member has taken, and what they owe. See docs/stock.md.
import { prisma } from "@/lib/server/db";
import { holdingWhere, rolesWith } from "@/lib/server/access";
import { isoDay, stockholmDay, today } from "@/lib/domain/date";
import type { StockSlug } from "@/lib/stock/stocks";

/** The stock the board takes from. One today (lib/stock/stocks.ts, `allowsBoardWithdrawals`). */
export const BOARD_STOCK: StockSlug = "cafe";

export interface BoardPriceDto {
  productId: string;
  name: string;
  /** For a scan on Nytt uttag, matched in the browser: a board member cannot read the stock's own lookup. */
  ean?: string;
  /** What a unit costs to buy, for the warning when the board price is under it. */
  costPriceOre: number | null;
  /** Whole units the log holds. */
  onHand: number;
  /** The price in force today, and since when. Null where the board cannot take the product. */
  priceOre: number | null;
  validFrom: string | null;
  /** A price already entered for a later day. */
  next: { priceOre: number; validFrom: string } | null;
  /** Every price it has had, newest first. */
  history: { priceOre: number; validFrom: string; by: string }[];
}

/** Every product of the board's stock with its price list. */
export async function getBoardPrices(): Promise<BoardPriceDto[]> {
  const day = today();
  const [products, sums] = await Promise.all([
    prisma.stockProduct.findMany({
      where: { stockId: BOARD_STOCK },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        ean: true,
        costPriceOre: true,
        boardPrices: {
          orderBy: { validFrom: "desc" },
          select: { priceOre: true, validFrom: true, createdBy: { select: { name: true } } },
        },
      },
    }),
    prisma.stockEntry.groupBy({
      by: ["productId"],
      where: { product: { stockId: BOARD_STOCK } },
      _sum: { units: true },
    }),
  ]);
  const held = new Map(sums.map((s) => [s.productId, s._sum.units ?? 0]));
  return products.map((p) => {
    const history = p.boardPrices.map((b) => ({
      priceOre: b.priceOre,
      validFrom: isoDay(b.validFrom),
      by: b.createdBy.name,
    }));
    const current = history.find((h) => h.validFrom <= day) ?? null;
    // The nearest of the prices that have not started yet.
    const next = [...history].reverse().find((h) => h.validFrom > day) ?? null;
    return {
      productId: p.id,
      name: p.name,
      ean: p.ean ?? undefined,
      costPriceOre: p.costPriceOre,
      onHand: held.get(p.id) ?? 0,
      priceOre: current?.priceOre ?? null,
      validFrom: current?.validFrom ?? null,
      next: next && { priceOre: next.priceOre, validFrom: next.validFrom },
      history,
    };
  });
}

/** One product's board price in force today, in öre. Null where the board cannot take it. */
export async function getBoardPrice(productId: string): Promise<number | null> {
  const price = await prisma.boardPrice.findFirst({
    where: { productId, validFrom: { lte: new Date(today()) } },
    orderBy: { validFrom: "desc" },
    select: { priceOre: true },
  });
  return price?.priceOre ?? null;
}

export interface BoardWithdrawalDto {
  id: string;
  /** The day it was taken. */
  date: string;
  memberId: string;
  memberName: string;
  productName: string;
  qty: number;
  unitPriceOre: number;
  amountOre: number;
  /** Written down by somebody else on the member's behalf. */
  loggedBy: string | null;
  /** The Fortnox invoice it is on, unconfirmed until it has a number there, or null while it is not invoiced. */
  invoiced: boolean;
  /** Logged today, so the member may still take it back. */
  fresh: boolean;
}

export async function getBoardWithdrawals(filter: {
  memberId?: string;
  /** Written down by this person, for themselves or on somebody's behalf. */
  loggedById?: string;
  invoiced?: boolean;
  from?: string;
  to?: string;
}): Promise<BoardWithdrawalDto[]> {
  const rows = await prisma.boardWithdrawal.findMany({
    where: {
      memberId: filter.memberId,
      loggedById: filter.loggedById,
      invoiceLineId:
        filter.invoiced === undefined ? undefined : filter.invoiced ? { not: null } : null,
      entry: {
        occurredAt: {
          gte: filter.from ? new Date(filter.from) : undefined,
          lte: filter.to ? new Date(filter.to) : undefined,
        },
      },
    },
    orderBy: [{ entry: { occurredAt: "desc" } }, { createdAt: "desc" }],
    take: 1000,
    select: {
      id: true,
      qty: true,
      unitPriceOre: true,
      memberId: true,
      loggedById: true,
      invoiceLineId: true,
      createdAt: true,
      member: { select: { name: true } },
      loggedBy: { select: { name: true } },
      entry: { select: { occurredAt: true, product: { select: { name: true } } } },
    },
  });
  const day = today();
  return rows.map((w) => ({
    id: w.id,
    date: isoDay(w.entry.occurredAt),
    memberId: w.memberId,
    memberName: w.member.name,
    productName: w.entry.product.name,
    qty: w.qty,
    unitPriceOre: w.unitPriceOre,
    amountOre: w.qty * w.unitPriceOre,
    loggedBy: w.loggedById === w.memberId ? null : w.loggedBy.name,
    invoiced: w.invoiceLineId != null,
    fresh: stockholmDay.format(w.createdAt) === day,
  }));
}

export interface BoardMemberDto {
  id: string;
  name: string;
  /** Still holds a tab, through a group or a personal grant. Groups follow Authentik at sign-in, so this can lag. */
  onBoard: boolean;
  uninvoicedOre: number;
  uninvoicedCount: number;
}

/** Everybody with a tab: who holds one now, and anybody with withdrawals that are not invoiced. */
export async function getBoardMembers(): Promise<BoardMemberDto[]> {
  const [roles, open] = await Promise.all([
    rolesWith("BOARD_TAB"),
    prisma.boardWithdrawal.findMany({
      where: { invoiceLineId: null },
      select: { memberId: true, qty: true, unitPriceOre: true },
    }),
  ]);
  const owing = new Map<string, { ore: number; count: number }>();
  for (const w of open) {
    const held = owing.get(w.memberId) ?? { ore: 0, count: 0 };
    held.ore += w.qty * w.unitPriceOre;
    held.count += 1;
    owing.set(w.memberId, held);
  }
  const holding = holdingWhere(roles, "BOARD_TAB");
  const [users, onBoard] = await Promise.all([
    prisma.user.findMany({
      where: { OR: [{ active: true, ...holding }, { id: { in: [...owing.keys()] } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({ where: { active: true, ...holding }, select: { id: true } }),
  ]);
  const holds = new Set(onBoard.map((u) => u.id));
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    onBoard: holds.has(u.id),
    uninvoicedOre: owing.get(u.id)?.ore ?? 0,
    uninvoicedCount: owing.get(u.id)?.count ?? 0,
  }));
}

/** Whether somebody has a tab to look at although they hold no board role any more. */
export async function hasWithdrawals(userId: string): Promise<boolean> {
  return (await prisma.boardWithdrawal.count({ where: { memberId: userId }, take: 1 })) > 0;
}

/** A settled tab: one invoice to a member and what was on it. */
export interface ClosedTabDto {
  id: string;
  invoiceDate: string;
  /** Fortnox's number, or null while Fortnox has not confirmed it. */
  documentNumber: string | null;
  totalOre: number;
  /** The Fortnox customer it went to, or is picked by default for sending it again. */
  customerNumber: string | null;
  /** The member, for finding their customer in Fortnox's register. */
  member: { name: string; email: string };
  /** The sales account and cost centre its lines carry, which may be changed before sending it again. */
  account: string;
  costCenterId: string | null;
  lines: { description: string; qty: number; unitPriceOre: number; amountOre: number }[];
}

/** A member's settled tabs, newest first. */
export async function getClosedTabs(memberId: string): Promise<ClosedTabDto[]> {
  const invoices = await prisma.customerInvoice.findMany({
    where: { source: "BOARD_TAB", customerId: memberId },
    orderBy: [{ invoiceDate: "desc" }, { sequence: "desc" }],
    select: {
      id: true,
      invoiceDate: true,
      fortnoxDocumentNumber: true,
      fortnoxCustomerNumber: true,
      customer: { select: { name: true, email: true, fortnoxCustomerNumber: true } },
      totalOre: true,
      lines: {
        orderBy: { sortOrder: "asc" },
        select: {
          description: true,
          qty: true,
          unitPriceOre: true,
          amountOre: true,
          account: true,
          costCenterId: true,
        },
      },
    },
  });
  return invoices.map((i) => ({
    id: i.id,
    invoiceDate: isoDay(i.invoiceDate),
    documentNumber: i.fortnoxDocumentNumber,
    customerNumber: i.fortnoxCustomerNumber ?? i.customer.fortnoxCustomerNumber,
    member: { name: i.customer.name, email: i.customer.email },
    totalOre: i.totalOre,
    account: i.lines[0]?.account ?? "",
    costCenterId: i.lines[0]?.costCenterId ?? null,
    lines: i.lines.map(({ description, qty, unitPriceOre, amountOre }) => ({
      description,
      qty,
      unitPriceOre,
      amountOre,
    })),
  }));
}
