// The overview's to-do list: everything waiting on the reader, each with the day it is due, sorted
// by how soon. Built from state, so a task leaves the list once it is done (no read or dismiss).
// The due days follow the redovisningsbetyg's clock (member-score.ts), so the list shows what costs points.
import { ATTEST_GRACE_DAYS, SUBMIT_GRACE_DAYS } from "./member-score";
import { REIMBURSEMENT_DEADLINE_DAYS } from "./status";

/** One thing only the reader can do, shown as a row of its own. */
export type TodoKind =
  /** Own utlägg, sent back. */
  | "fix"
  /** Own utlägg, not sent yet. */
  | "draft"
  /** A purchase on the reader's card with no utlägg yet. */
  | "cardPurchase"
  /** Someone else's utlägg, waiting for the reader's attest. */
  | "attestExpense"
  /** A levfaktura, waiting for the reader's attest. */
  | "attestInvoice"
  /** A levfaktura, or a document in the unit's Inkorg, waiting for the reader's unit to fördela it. */
  | "allocateInvoice"
  | "allocateDocument"
  /** Treasury: a levfaktura to kontera, or konterad and waiting to be sent to Fortnox. */
  | "bookInvoice"
  | "sendInvoice";

export interface TodoItem {
  kind: TodoKind;
  id: string;
  title: string;
  /** Who it came from: the submitter of an utlägg, the unit of a faktura. */
  who: string | null;
  /** SEK. */
  amount: number | null;
  /** YYYY-MM-DD. */
  due: string;
  /** Days from today to `due`, negative once passed. Computed on the server so both sides render the same. */
  inDays: number;
}

/** Work done in batches, shown as one row with a count. */
export type TodoGroupKind =
  | "sortInbox"
  | "bookExpenses"
  | "exportExpenses"
  | "cardless"
  | "overdueElsewhere"
  | "membersBehind";

export interface TodoGroup {
  kind: TodoGroupKind;
  count: number;
}

export type TodoBand = "late" | "week" | "later";

/** Due inside this many days and it is this week's. */
const WEEK_DAYS = 7;

const DAY_MS = 86_400_000;
export const plusDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const daysFrom = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const earlier = (a: string, b: string | null) => (b && b < a ? b : a);

/** The day each kind of task is due. Every date is YYYY-MM-DD. */
export const dueOf = {
  /** Sent back: due the day it came back. */
  fix: (sentBackOn: string) => sentBackOn,
  /** Paid out of pocket: the filing deadline. On a card: the week the score allows. */
  draft: (purchasedOn: string, onCard: boolean) =>
    plusDays(purchasedOn, onCard ? SUBMIT_GRACE_DAYS : REIMBURSEMENT_DEADLINE_DAYS),
  /** `startedOn` is the later of the purchase and its bank row's import. */
  cardPurchase: (startedOn: string) => plusDays(startedOn, SUBMIT_GRACE_DAYS),
  /** From the day it reached the reader, or the faktura's own due date if that comes first. */
  attest: (readyOn: string, invoiceDue: string | null = null) =>
    earlier(plusDays(readyOn, ATTEST_GRACE_DAYS), invoiceDue),
};

export function bandOf(inDays: number): TodoBand {
  if (inDays < 0) return "late";
  if (inDays <= WEEK_DAYS) return "week";
  return "later";
}

export function todoItem(item: Omit<TodoItem, "inDays">, today: string): TodoItem {
  return { ...item, inDays: daysFrom(today, item.due) };
}

/** The list in bands, soonest due first in each. Bands with nothing in them are left out. */
export function bandTodos(items: readonly TodoItem[]): { band: TodoBand; items: TodoItem[] }[] {
  const sorted = [...items].sort(
    (a, b) => a.inDays - b.inDays || a.title.localeCompare(b.title, "sv"),
  );
  return (["late", "week", "later"] as const)
    .map((band) => ({ band, items: sorted.filter((i) => bandOf(i.inDays) === band) }))
    .filter((b) => b.items.length > 0);
}
