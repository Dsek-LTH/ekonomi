// What Översikt reads besides the queue and the budget: what has been
// forgotten, what is coming up, and the invoices in your units.
//
// Each part reads only what its viewer may already reach on the page it links
// to, gated by the same capability as that page.
import "server-only";

import { prisma } from "@/lib/server/db";
import { REIMBURSEMENT_DEADLINE_DAYS } from "@/lib/domain/status";
import { today } from "@/lib/domain/date";
import { canSeeInvoices, canViewContracts, canViewRentals, canViewStock } from "@/lib/domain/permissions";
import type { SupplierInvoiceStatus } from "@/lib/domain/types";
import type { Viewer } from "./expense-scope";
import { invoiceScopeWhere, invoiceViewerOf } from "./supplier-invoices";
import { isoDate } from "./shared";

const DAY_MS = 86_400_000;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const plusDays = (iso: string, n: number) => isoDate(new Date(day(iso).getTime() + n * DAY_MS));
const daysUntil = (from: string, to: string) => Math.round((day(to).getTime() - day(from).getTime()) / DAY_MS);

// ── Forgotten ─────────────────────────────────────────────────────

/** An utlägg sent in and not attested for this long is stuck. */
const STUCK_DAYS = 14;
/** One waiting on your attest for this long has been forgotten by you. */
const ATTEST_STALE_DAYS = 7;

/**
 * Which of these utlägg were last sent in more than `olderThan` days ago, with
 * how many days. The latest SUBMITTED event is when, since an utlägg sent back
 * and sent again has started waiting over.
 */
async function staleSince(ids: string[], olderThan: number): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.expenseEvent.groupBy({
    by: ["expenseId"],
    where: { expenseId: { in: ids }, type: "SUBMITTED" },
    _max: { createdAt: true },
  });
  const now = Date.now();
  const out = new Map<string, number>();
  for (const r of rows) {
    const at = r._max.createdAt;
    if (!at) continue;
    const days = Math.floor((now - at.getTime()) / DAY_MS);
    if (days > olderThan) out.set(r.expenseId, days);
  }
  return out;
}

/** Your own utlägg that have waited on attest longer than STUCK_DAYS. */
export async function getStuckOwn(userId: string): Promise<{ id: string; title: string; days: number }[]> {
  const pending = await prisma.expense.findMany({
    where: { submitterId: userId, status: "PENDING_APPROVAL" },
    select: { id: true, title: true },
  });
  const stale = await staleSince(pending.map((e) => e.id), STUCK_DAYS);
  return pending.flatMap((e) => (stale.has(e.id) ? [{ ...e, days: stale.get(e.id)! }] : []));
}

/** How many of these (the viewer's attest queue) have waited past a week. */
export async function countStaleAttests(ids: string[]): Promise<number> {
  return (await staleSince(ids, ATTEST_STALE_DAYS)).size;
}

/** Invoices past their due date and still not in Fortnox, the oldest first. */
export async function getOverdueInvoices(
  viewer: Viewer,
): Promise<{ id: string; title: string; days: number }[]> {
  if (!canSeeInvoices(viewer.capabilities)) return [];
  const now = today();
  const rows = await prisma.supplierInvoice.findMany({
    where: {
      ...invoiceScopeWhere(await invoiceViewerOf(viewer)),
      status: { not: "EXPORTED" },
      dueDate: { lt: day(now) },
    },
    orderBy: { dueDate: "asc" },
    select: { id: true, supplierName: true, description: true, dueDate: true },
  });
  return rows.map((i) => ({
    id: i.id,
    title: i.supplierName ?? i.description ?? "",
    days: daysUntil(isoDate(i.dueDate), now),
  }));
}

// ── Coming up ─────────────────────────────────────────────────────

/** How far ahead the list looks. Contracts get longer: a renewal is planned. */
const AHEAD_DAYS = 14;
const CONTRACT_AHEAD_DAYS = 30;
const UPCOMING_TAKE = 8;

export interface UpcomingItem {
  kind: "deadline" | "invoice" | "pickup" | "contractEnds" | "stockEvent";
  id: string;
  title: string;
  date: string;
  /** Days from today. Worked out here so the server's render and the
   *  browser's say the same thing. */
  inDays: number;
}

export async function getUpcoming(viewer: Viewer): Promise<UpcomingItem[]> {
  const now = today();
  const from = day(now);
  const ahead = day(plusDays(now, AHEAD_DAYS));
  const caps = viewer.capabilities;

  const [deadlines, invoices, pickups, contracts, events] = await Promise.all([
    // Your own out-of-pocket claims not yet sent, whose filing deadline falls
    // in the window. The purchase date is the deadline less sixty days.
    prisma.expense.findMany({
      where: {
        submitterId: viewer.id,
        status: { in: ["DRAFT", "CHANGES_REQUESTED"] },
        paymentType: { in: ["REIMBURSEMENT", "MILEAGE"] },
        deadlineWaivedAt: null,
        purchaseDate: {
          gte: day(plusDays(now, -REIMBURSEMENT_DEADLINE_DAYS)),
          lte: day(plusDays(now, AHEAD_DAYS - REIMBURSEMENT_DEADLINE_DAYS)),
        },
      },
      select: { id: true, title: true, purchaseDate: true },
    }),
    // Not yet due. One already past it is under Glömt instead.
    canSeeInvoices(caps)
      ? invoiceViewerOf(viewer).then((v) =>
          prisma.supplierInvoice.findMany({
            where: { ...invoiceScopeWhere(v), status: { not: "EXPORTED" }, dueDate: { gte: from, lte: ahead } },
            orderBy: { dueDate: "asc" },
            take: UPCOMING_TAKE,
            select: { id: true, supplierName: true, description: true, dueDate: true },
          }),
        )
      : [],
    canViewRentals(caps)
      ? prisma.rentalDetails.findMany({
          where: { pickupAt: { gte: from, lte: ahead } },
          orderBy: { pickupAt: "asc" },
          take: UPCOMING_TAKE,
          select: { contractId: true, pickupAt: true, contract: { select: { title: true } } },
        })
      : [],
    canViewContracts(caps)
      ? prisma.agreementDetails.findMany({
          where: { validTo: { gte: from, lte: day(plusDays(now, CONTRACT_AHEAD_DAYS)) } },
          orderBy: { validTo: "asc" },
          take: UPCOMING_TAKE,
          select: { contractId: true, validTo: true, contract: { select: { title: true } } },
        })
      : [],
    canViewStock(caps)
      ? prisma.stockEvent.findMany({
          where: { date: { gte: from, lte: ahead } },
          orderBy: { date: "asc" },
          take: UPCOMING_TAKE,
          select: { id: true, name: true, date: true },
        })
      : [],
  ]);

  const items: Omit<UpcomingItem, "inDays">[] = [
    ...deadlines.map((e) => ({
      kind: "deadline" as const,
      id: e.id,
      title: e.title,
      date: plusDays(isoDate(e.purchaseDate), REIMBURSEMENT_DEADLINE_DAYS),
    })),
    ...invoices.map((i) => ({
      kind: "invoice" as const,
      id: i.id,
      title: i.supplierName ?? i.description ?? "",
      date: isoDate(i.dueDate),
    })),
    ...pickups.map((r) => ({
      kind: "pickup" as const,
      id: r.contractId,
      title: r.contract.title,
      date: isoDate(r.pickupAt),
    })),
    ...contracts.map((a) => ({
      kind: "contractEnds" as const,
      id: a.contractId,
      title: a.contract.title,
      date: isoDate(a.validTo),
    })),
    ...events.map((e) => ({ kind: "stockEvent" as const, id: e.id, title: e.name, date: isoDate(e.date) })),
  ];
  return items
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, UPCOMING_TAKE)
    .map((i) => ({ ...i, inDays: daysUntil(now, i.date) }));
}

// ── Your units' invoices ──────────────────────────────────────────

export interface UnitInvoice {
  id: string;
  title: string;
  status: SupplierInvoiceStatus;
}

/** The latest invoices in the result units you answer for. Empty for anyone
 *  who answers for none, the treasury included: theirs is the invoice list. */
export async function getUnitInvoices(viewer: Viewer, take: number): Promise<UnitInvoice[]> {
  if (!canSeeInvoices(viewer.capabilities)) return [];
  const v = await invoiceViewerOf(viewer);
  if (v.ownedResultUnitIds.length === 0 && v.ownedPrefixes.length === 0) return [];
  const rows = await prisma.supplierInvoice.findMany({
    where: invoiceScopeWhere(v, { ownUnits: true }),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: { id: true, supplierName: true, description: true, status: true },
  });
  return rows.map((i) => ({ id: i.id, title: i.supplierName ?? i.description ?? "", status: i.status }));
}
