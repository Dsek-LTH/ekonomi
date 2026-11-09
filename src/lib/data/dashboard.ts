import "server-only";

import { prisma } from "@/lib/server/db";
import { REIMBURSEMENT_DEADLINE_DAYS } from "@/lib/domain/status";
import { today } from "@/lib/domain/date";
import {
  canSeeInvoices,
  canViewContracts,
  canViewRentals,
  canViewStock,
} from "@/lib/domain/permissions";
import type { SupplierInvoiceStatus } from "@/lib/domain/types";
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
/** One waiting on your attest for this long has been forgotten by you. */
const ATTEST_STALE_DAYS = 7;

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

export async function countStaleAttests(ids: string[]): Promise<number> {
  return (await staleSince(ids, ATTEST_STALE_DAYS)).size;
}

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

/** How far ahead the list looks. Contracts get longer: a renewal is planned. */
const AHEAD_DAYS = 14;
const CONTRACT_AHEAD_DAYS = 30;
const UPCOMING_TAKE = 8;

export interface UpcomingItem {
  kind: "deadline" | "invoice" | "pickup" | "contractEnds" | "stockEvent";
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

  const [deadlines, invoices, pickups, contracts, events] = await Promise.all([
    // Own unsent out-of-pocket claims whose filing deadline (purchase date + 60 days) is in the window.
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
    // Not yet due. One already past it is a late row under Din tur instead.
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
    canViewRentals(caps)
      ? prisma.rentalDetails.findMany({
          where: { pickupAt: { gte: from, lte: ahead } },
          orderBy: { pickupAt: "asc" },
          take: UPCOMING_TAKE,
          select: {
            contractId: true,
            pickupAt: true,
            contract: { select: { title: true } },
          },
        })
      : [],
    canViewContracts(caps)
      ? prisma.agreementDetails.findMany({
          where: { validTo: { gte: from, lte: day(plusDays(now, CONTRACT_AHEAD_DAYS)) } },
          orderBy: { validTo: "asc" },
          take: UPCOMING_TAKE,
          select: {
            contractId: true,
            validTo: true,
            contract: { select: { title: true } },
          },
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

export interface UnitInvoice {
  id: string;
  title: string;
  status: SupplierInvoiceStatus;
}

/** The latest invoices in the result units you answer for. Empty for anyone answering for none. */
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
  return rows.map((i) => ({
    id: i.id,
    title: i.supplierName ?? i.description ?? "",
    status: i.status,
  }));
}
