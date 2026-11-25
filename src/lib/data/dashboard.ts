import "server-only";

import { prisma } from "@/lib/server/db";
import { today } from "@/lib/domain/date";
import {
  canSeeInvoices,
  canViewStock,
} from "@/lib/domain/permissions";
import type { Viewer } from "./expense-scope";
import { invoiceScopeWhere, invoiceViewerOf } from "./supplier-invoices";
import { isoDate } from "./shared";

const DAY_MS = 86_400_000;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const plusDays = (iso: string, n: number) => isoDate(new Date(day(iso).getTime() + n * DAY_MS));
const daysUntil = (from: string, to: string) =>
  Math.round((day(to).getTime() - day(from).getTime()) / DAY_MS);

/** An utlägg sent in and not attested for this long is stuck. */
const STUCK_DAYS = 14;

/** Utlägg last sent in over `olderThan` days ago, with the days. The latest SUBMITTED event counts (resent starts over). */
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

export interface WaitingOwn {
  id: string;
  title: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "BOOKED";
  days: number;
  stuck: boolean;
}

/** Your own utlägg waiting on attest or on the treasury, longest first. Not limited to the räkenskapsår. */
export async function getWaitingOnOthers(userId: string): Promise<WaitingOwn[]> {
  const rows = await prisma.expense.findMany({
    where: { submitterId: userId, status: { in: ["PENDING_APPROVAL", "APPROVED", "BOOKED"] } },
    select: { id: true, title: true, status: true },
  });
  const since = await staleSince(
    rows.map((e) => e.id),
    -1,
  );
  return rows
    .map((e) => {
      const days = since.get(e.id) ?? 0;
      const status = e.status as WaitingOwn["status"];
      return {
        ...e,
        status,
        days,
        stuck: status === "PENDING_APPROVAL" && days > STUCK_DAYS,
      };
    })
    .sort((a, b) => b.days - a.days);
}

/** How far ahead the list looks. */
const AHEAD_DAYS = 14;
const UPCOMING_TAKE = 8;

export interface UpcomingItem {
  kind: "invoice" | "stockEvent";
  id: string;
  title: string;
  date: string;
  /** Days from today, computed here so server and browser render the same. */
  inDays: number;
}

export async function getUpcoming(viewer: Viewer): Promise<UpcomingItem[]> {
  const now = today();
  const from = day(now);
  const ahead = day(plusDays(now, AHEAD_DAYS));
  const caps = viewer.capabilities;

  const [invoices, events] = await Promise.all([
    // Not yet due. One already past it, or waiting on the reader, is on the to-do list instead.
    canSeeInvoices(caps)
      ? invoiceViewerOf(viewer).then((v) =>
          prisma.supplierInvoice.findMany({
            where: {
              ...invoiceScopeWhere(v),
              status: { not: "EXPORTED" },
              dueDate: { gte: from, lte: ahead },
            },
            orderBy: { dueDate: "asc" },
            take: UPCOMING_TAKE,
            select: { id: true, supplierName: true, description: true, dueDate: true },
          }),
        )
      : [],
    canViewStock(caps, "alcohol")
      ? prisma.stockEvent.findMany({
          where: { stockId: "alcohol", date: { gte: from, lte: ahead } },
          orderBy: { date: "asc" },
          take: UPCOMING_TAKE,
          select: { id: true, name: true, date: true },
        })
      : [],
  ]);

  const items: Omit<UpcomingItem, "inDays">[] = [
    ...invoices.map((i) => ({
      kind: "invoice" as const,
      id: i.id,
      title: i.supplierName ?? i.description ?? "",
      date: isoDate(i.dueDate),
    })),
    ...events.map((e) => ({
      kind: "stockEvent" as const,
      id: e.id,
      title: e.name,
      date: isoDate(e.date),
    })),
  ];
  return items
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, UPCOMING_TAKE)
    .map((i) => ({ ...i, inDays: daysUntil(now, i.date) }));
}
