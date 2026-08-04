"use client";

// The columns every bank-transaction list is built from.
//
// The same reasoning as components/expense-columns.tsx, and the same history:
// Bank & matching and Card purchases showed the same rows — date, what was
// bought, which card, how much, which utlägg — with a private copy of the cell
// markup, the sort/search flags and the alignment in each. Two copies of a
// column is two places for the amount to be set differently, which is exactly
// what happened.
//
// A page picks the columns it wants, in the order it wants, and adds its own
// (the delete button, the "redovisa" link) alongside them.

import Link from "next/link";
import { Amount } from "./ui/amount";
import type { Column } from "@/components/ui/data-table";
import type { BankTransaction } from "@/lib/domain/types";

// Headers are passed in rather than translated here: these are built outside a
// component, and the same column is headed differently per page — the bank
// calls it "Transaktion", the card-holder's own list calls it "Inköpsställe".
export const bankDateColumn = (
  header: string,
  // The reader's date format, from useFormat() in the page that builds the
  // column — a factory called at module scope cannot ask for it itself.
  date: (iso: string) => string,
): Column<BankTransaction> => ({
  key: "date",
  header,
  value: (tx) => tx.bookedDate,
  sortable: true,
  dateRange: true,
  className: "whitespace-nowrap text-muted",
  cell: (tx) => date(tx.bookedDate),
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

/** Just the card number — for a list where every row is the same person's. */
export const bankCardColumn = (header: string, hidden = false): Column<BankTransaction> => ({
  key: "card",
  header,
  hidden,
  className: "text-muted",
  cell: (tx) => (tx.cardLast4 ? <span className="tabular-nums">····{tx.cardLast4}</span> : "–"),
});

/** Who holds the card, with its number under it — for the section-wide list. */
export const bankHolderColumn = (header: string): Column<BankTransaction> => ({
  key: "holder",
  header,
  value: (tx) => tx.cardHolderName ?? "",
  sortable: true,
  searchable: true,
  cell: (tx) => (
    <>
      <p className="text-sm font-medium">{tx.cardHolderName}</p>
      {tx.cardLast4 && (
        <p className="text-xs tabular-nums text-muted">····{tx.cardLast4}</p>
      )}
    </>
  ),
});

// Money the way the app sets money everywhere else — `Amount`, not a flat
// string (see DESIGN.md).
//
// Deliberately *not* `signed`. On a bank statement a negative amount is the
// ordinary case — money left the account — and colouring every purchase red
// would say something is wrong with all of them. It is the positive one that is
// worth noticing: a refund or a return coming back in.
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
 * The utlägg this purchase was accounted for as, as a link to it — the one
 * place on either bank table that answers "has this been dealt with, and by
 * what". Unaccounted rows are a dash, so a column of links reads as the work
 * that is done and the gaps as the work that isn't.
 *
 * `linked` names a match that has no reference yet: an utlägg is only numbered
 * when it is submitted for attest (see lib/domain/reference.ts), so a purchase
 * someone is still filling in is genuinely accounted for and genuinely has
 * nothing to be called. It still links — that half-finished utlägg is exactly
 * what a reader following this column wants to find.
 */
export const bankMatchedColumn = (
  header: string,
  { dash = "–", linked }: { dash?: string; linked?: string } = {},
): Column<BankTransaction> => ({
  key: "matched",
  header,
  // Sorted and searched on what the reader sees, not on the id behind the link.
  value: (tx) => tx.matchedExpenseRef ?? (tx.matchedExpenseId ? linked ?? "" : ""),
  sortable: true,
  searchable: true,
  className: "whitespace-nowrap tabular-nums",
  cell: (tx) =>
    tx.matchedExpenseId ? (
      <Link
        href={`/expenses/${tx.matchedExpenseId}`}
        className="font-medium text-accent hover:underline"
      >
        {tx.matchedExpenseRef ?? linked ?? dash}
      </Link>
    ) : (
      <span className="text-muted">{dash}</span>
    ),
});
