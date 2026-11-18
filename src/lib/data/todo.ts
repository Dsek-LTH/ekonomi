// The overview's to-do list (lib/domain/todo.ts) read off the database: one row per thing only the
// reader can do, and counts for the treasury's batch work.
import "server-only";

import { prisma } from "@/lib/server/db";
import type { During } from "@/lib/server/fiscal-year";
import { canBookkeep, canTriageInvoices, canSeeInvoices } from "@/lib/domain/permissions";
import { awaitsAllocation, invoiceQueue } from "@/lib/domain/supplier-invoice";
import { oreToSEK } from "@/lib/domain/money";
import { isoDay, stockholmDay } from "@/lib/domain/date";
import type { QueueItem } from "@/lib/domain/queue";
import { dueOf, todoItem, type TodoGroup, type TodoItem } from "@/lib/domain/todo";
import { invoiceFactsOf, invoiceScopeWhere, invoiceViewerOf } from "./supplier-invoices";
import { countCardlessTransactions } from "./bank";
import type { Viewer } from "./expense-scope";

const momentDay = (d: Date) => stockholmDay.format(d);
const later = (a: string, b: string) => (a > b ? a : b);

/** The day of each utlägg's latest event of one type. */
async function lastEventDay(ids: string[], type: "SUBMITTED" | "CHANGES_REQUESTED") {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await prisma.expenseEvent.groupBy({
    by: ["expenseId"],
    where: { expenseId: { in: ids }, type },
    _max: { createdAt: true },
  });
  return new Map(
    rows.flatMap((r) => (r._max.createdAt ? [[r.expenseId, momentDay(r._max.createdAt)]] : [])),
  );
}

/** When a faktura last came to its units: given, sent back, or a signature taken off or added. */
const INVOICE_READY_EVENTS = [
  "ASSIGNED",
  "CHANGES_REQUESTED",
  "ATTEST_WITHDRAWN",
  "COST_CENTER_APPROVED",
] as const;

export async function getTodos(
  viewer: Viewer,
  /** The utlägg queue (buildQueue), already read for the reader. */
  queue: readonly QueueItem[],
  today: string,
  { during }: { during?: During } = {},
): Promise<{ items: TodoItem[]; groups: TodoGroup[] }> {
  const ids = (a: QueueItem["action"]) =>
    queue.filter((q) => q.action === a).map((q) => q.expense.id);
  const [sentBack, submitted, purchases, invoices, cardless] = await Promise.all([
    lastEventDay(ids("FIX"), "CHANGES_REQUESTED"),
    lastEventDay(ids("ATTEST"), "SUBMITTED"),
    // The same purchases the score counts: money out, on the reader's card, with no utlägg yet.
    prisma.bankTransaction.findMany({
      where: {
        card: { holderId: viewer.id },
        matchedExpense: { is: null },
        amount: { lt: 0 },
        ...(during ? { transactionDate: during } : {}),
      },
      select: {
        id: true,
        description: true,
        amount: true,
        transactionDate: true,
        importedAt: true,
      },
    }),
    canSeeInvoices(viewer.capabilities) ? invoiceTodos(viewer, today) : null,
    canBookkeep(viewer.capabilities) ? countCardlessTransactions({ during }) : 0,
  ]);

  const items: TodoItem[] = [];
  for (const { expense: e, action } of queue) {
    const base = { id: e.id, title: e.title, amount: e.grossAmount };
    const bought = e.purchaseDate.slice(0, 10);
    if (action === "FIX") {
      const on = sentBack.get(e.id) ?? today;
      items.push(todoItem({ ...base, kind: "fix", who: null, due: dueOf.fix(on) }, today));
    } else if (action === "SUBMIT") {
      const due = dueOf.draft(bought, e.paymentType === "CARD");
      items.push(todoItem({ ...base, kind: "draft", who: null, due }, today));
    } else if (action === "ATTEST") {
      const due = dueOf.attest(submitted.get(e.id) ?? today);
      items.push(todoItem({ ...base, kind: "attestExpense", who: e.submitterName, due }, today));
    }
  }
  for (const p of purchases) {
    const started = later(isoDay(p.transactionDate), momentDay(p.importedAt));
    items.push(
      todoItem(
        {
          kind: "cardPurchase",
          id: p.id,
          title: p.description,
          who: null,
          amount: -oreToSEK(p.amount),
          due: dueOf.cardPurchase(started),
        },
        today,
      ),
    );
  }
  if (invoices) items.push(...invoices.items);

  const count = (a: QueueItem["action"]) => queue.filter((q) => q.action === a).length;
  const groups: TodoGroup[] = [
    { kind: "sortInbox" as const, count: invoices?.unsorted ?? 0 },
    { kind: "bookExpenses" as const, count: count("BOOK") },
    { kind: "exportExpenses" as const, count: count("EXPORT") },
    { kind: "cardless" as const, count: cardless },
    { kind: "overdueElsewhere" as const, count: invoices?.overdueElsewhere ?? 0 },
  ].filter((g) => g.count > 0);
  return { items, groups };
}

/** Fakturor waiting on the reader, and the counts around them. Not narrowed by räkenskapsår: a faktura is due when it is due. */
async function invoiceTodos(viewer: Viewer, today: string) {
  const v = await invoiceViewerOf(viewer);
  const triage = canTriageInvoices(v.capabilities);
  const [rows, unsorted] = await Promise.all([
    prisma.supplierInvoice.findMany({
      where: { AND: [invoiceScopeWhere(v), { status: { not: "EXPORTED" } }] },
      select: {
        id: true,
        status: true,
        resultUnitId: true,
        reference: true,
        supplierName: true,
        description: true,
        amount: true,
        dueDate: true,
        createdAt: true,
        resultUnit: { select: { name: true } },
        allocations: { select: { approvedById: true, costCenter: { select: { code: true } } } },
        events: {
          where: { type: { in: [...INVOICE_READY_EVENTS] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
    triage ? prisma.supplierInvoiceDocument.count({ where: { invoiceId: null } }) : 0,
  ]);

  const items: TodoItem[] = [];
  let overdueElsewhere = 0;
  for (const r of rows) {
    const due = r.dueDate ? isoDay(r.dueDate) : null;
    const queue = invoiceQueue(v, invoiceFactsOf(v, r));
    const base = {
      id: r.id,
      title: r.supplierName ?? r.description ?? r.reference ?? "",
      who: r.resultUnit?.name ?? null,
      amount: r.amount == null ? null : oreToSEK(r.amount),
    };
    if (queue === "attest") {
      const ready = momentDay(r.events[0]?.createdAt ?? r.createdAt);
      const kind = awaitsAllocation(r.status) ? "allocateInvoice" : "attestInvoice";
      items.push(todoItem({ ...base, kind, due: dueOf.attest(ready, due) }, today));
    } else if (queue === "export") {
      const kind = r.status === "APPROVED" ? "bookInvoice" : "sendInvoice";
      // Every faktura has a due date by the time it is attested; the fallback is for an odd one.
      items.push(todoItem({ ...base, kind, due: due ?? today }, today));
    } else if (due && due < today) {
      overdueElsewhere++;
    }
  }
  return { items, unsorted, overdueElsewhere };
}
