"use client";

// The columns every bank-transaction list is built from; a page picks and orders them and
// adds its own (delete, "redovisa"). Shared with components/columns/expense-columns.tsx.

import type { ReactNode } from "react";
import Link from "next/link";
import { Amount } from "@/components/ui/amount";
import type { Column } from "@/components/ui/data-table";
import type { BankTransaction } from "@/lib/domain/types";

// Headers are passed in: built outside a component, and headed differently per page.
export const bankDateColumn = (
  header: string,
  // The reader's date format (useFormat()), since a module-scope factory cannot ask.
  date: (iso: string) => string,
): Column<BankTransaction> => ({
  key: "date",
  header,
  value: (tx) => tx.transactionDate,
  sortable: true,
  dateRange: true,
  className: "whitespace-nowrap text-muted",
  mobile: "meta",
  mobileOrder: 1,
  cell: (tx) => date(tx.transactionDate),
});

export const bankDescriptionColumn = (header: string): Column<BankTransaction> => ({
  key: "description",
  header,
  value: (tx) => tx.description,
  sortable: true,
  searchable: true,
  mobile: "title",
  className: "font-medium",
  cell: (tx) => <p className="truncate">{tx.description}</p>,
});

/** A card's last four with the four-dot mask, written in one place. */
export const cardMask = (last4: string) => `····${last4}`;

export const bankCardColumn = (header: string, hidden = false): Column<BankTransaction> => ({
  key: "card",
  header,
  hidden,
  className: "text-muted",
  mobile: "meta",
  cell: (tx) => (tx.cardLast4 ? <span className="tabular-nums">····{tx.cardLast4}</span> : "-"),
});

/**
 * Who holds the card a purchase sat on, with its number. A component so a screen that lets
 * the card be changed draws the same markup. "No card" (the import names a card only when
 * the Referens ends in K####) is ordinary and reads as a dash.
 */
export function BankCardHolder({ tx }: { tx: BankTransaction }) {
  if (!tx.cardLast4) return <span className="text-muted"></span>;
  // Spans, not paragraphs: a changeable screen wraps this in a button (phrasing content only).
  // The name truncates first, the number never. Capped at the picker's 176px, since a cell's
  // width is only a floor.
  return (
    <span className="flex min-w-0 max-w-44 items-baseline gap-1.5">
      <span title={tx.cardHolderName} className="min-w-0 truncate text-sm font-medium">
        {tx.cardHolderName}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted">····{tx.cardLast4}</span>
    </span>
  );
}

/** Who holds the card, for the section-wide list. `cell` (a page offering to change the card) is still sorted and searched on the holder's name. */
export const bankHolderColumn = (
  header: string,
  cell?: (tx: BankTransaction) => ReactNode,
): Column<BankTransaction> => ({
  key: "holder",
  header,
  value: (tx) => tx.cardHolderName ?? "",
  // The name alone on a phone; a page needing the picker there moves this column to `status`.
  mobile: "meta",
  mobileCell: (tx) => tx.cardHolderName ?? null,
  sortable: true,
  searchable: true,
  // Fixed width and height so swapping between name, picker and dash does not reflow the
  // table. 200px is the picker's 176 plus padding. Fixed 32px because an inline button picks
  // up descender space and changes the row height. From md only: on a phone the cell is in
  // the card's line of small text.
  className: "w-50",
  cell: (tx) => (
    <div className="flex flex-col justify-center md:h-8">
      {cell ? cell(tx) : <BankCardHolder tx={tx} />}
    </div>
  ),
});

// Money via `Amount`, not `signed`: a negative amount is the ordinary case on a statement,
// so only the positive one (a refund) is worth noticing.
export const bankAmountColumn = (header: string): Column<BankTransaction> => ({
  key: "amount",
  header,
  align: "right",
  value: (tx) => tx.amount,
  sortable: true,
  mobile: "trailing",
  className: "whitespace-nowrap",
  cell: (tx) => <Amount value={tx.amount} className={tx.amount > 0 ? "text-success" : undefined} />,
});

/**
 * The utlägg this purchase was accounted for as, linked. `linked` is a match with no
 * reference yet (numbered only when submitted for attest, lib/domain/reference.ts), which
 * still links. `unmatched` draws the way to make one ("Redovisa") where the page offers it.
 */
export const bankMatchedColumn = (
  header: string,
  { linked, unmatched }: { linked: string; unmatched: (tx: BankTransaction) => ReactNode },
): Column<BankTransaction> => ({
  key: "matched",
  header,
  value: (tx) => tx.matchedExpenseRef ?? (tx.matchedExpenseId ? linked : ""),
  sortable: true,
  searchable: true,
  align: "right",
  className: "whitespace-nowrap tabular-nums",
  cell: (tx) =>
    tx.matchedExpenseId ? (
      <Link
        href={`/expenses/${tx.matchedExpenseId}`}
        className="font-medium text-link underline decoration-link/40 underline-offset-2 hover:decoration-current"
      >
        {tx.matchedExpenseRef ?? linked}
      </Link>
    ) : (
      unmatched(tx)
    ),
});
