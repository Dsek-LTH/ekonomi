"use client";

// The columns every bank-transaction list is built from.
//
// The same reasoning as components/columns/expense-columns.tsx, and the same
// history: Bank & matching and Card purchases showed the same rows (date,
// what was bought, which card, how much, which utlägg) with a private copy
// of the cell markup, the sort/search flags and the alignment in each. Two
// copies of a column is two places for the amount to be set differently,
// which is exactly what happened.
//
// A page picks the columns it wants, in the order it wants, and adds its own
// (the delete button, the "redovisa" link) alongside them.

import type { ReactNode } from "react";
import Link from "next/link";
import { Amount } from "@/components/ui/amount";
import type { Column } from "@/components/ui/data-table";
import type { BankTransaction } from "@/lib/domain/types";

// Headers are passed in rather than translated here: these are built outside a
// component, and the same column is headed differently per page. The bank
// calls it "Transaktion", the card-holder's own list calls it "Inköpsställe".
export const bankDateColumn = (
  header: string,
  // The reader's date format, from useFormat() in the page that builds the
  // column. A factory called at module scope cannot ask for it itself.
  date: (iso: string) => string,
): Column<BankTransaction> => ({
  key: "date",
  header,
  value: (tx) => tx.transactionDate,
  sortable: true,
  dateRange: true,
  className: "whitespace-nowrap text-muted",
  // On a phone the second line is whose card and when, in that order.
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

/** A card's last four as the app writes them everywhere: a four-dot mask
 *  before the digits. Here, with the other card masks, so the mask is written
 *  in one place (see AGENTS.md on the dots). */
export const cardMask = (last4: string) => `····${last4}`;

/** Just the card number, for a list where every row is the same person's. */
export const bankCardColumn = (header: string, hidden = false): Column<BankTransaction> => ({
  key: "card",
  header,
  hidden,
  className: "text-muted",
  mobile: "meta",
  cell: (tx) => (tx.cardLast4 ? <span className="tabular-nums">····{tx.cardLast4}</span> : "-"),
});

/**
 * Who holds the card a purchase sat on, with its number beside it.
 *
 * A component rather than only a cell body, because a screen that lets the card
 * be changed still has to draw the row as it stands, and a second copy of this
 * markup is a second place for the two to drift apart.
 *
 * The import can only name a card when the Referens carried a trailing K####,
 * so "no card" is an ordinary state of a row rather than a fault, and it reads
 * as the dash every other empty cell in the app uses.
 */
export function BankCardHolder({ tx }: { tx: BankTransaction }) {
  if (!tx.cardLast4) return <span className="text-muted"></span>;
  // Spans rather than paragraphs: a screen that lets the card be changed wraps
  // this in a button, and a button may only hold phrasing content.
  //
  // One line: the name gives way first and truncates, the number never does,
  // since it is the short exact part and the one a reader checks against the
  // statement. Capped at the card picker's 176px: a table cell's width is
  // only a floor, and a long name would otherwise widen the column instead.
  return (
    <span className="flex min-w-0 max-w-44 items-baseline gap-1.5">
      <span title={tx.cardHolderName} className="min-w-0 truncate text-sm font-medium">
        {tx.cardHolderName}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted">····{tx.cardLast4}</span>
    </span>
  );
}

/**
 * Who holds the card, with its number beside it, for the section-wide list.
 *
 * `cell` is passed by a page that offers to change the card. It is still sorted
 * and searched on the holder's name, because that is what the reader sees
 * whichever control the cell is drawn as.
 */
export const bankHolderColumn = (
  header: string,
  cell?: (tx: BankTransaction) => ReactNode,
): Column<BankTransaction> => ({
  key: "holder",
  header,
  value: (tx) => tx.cardHolderName ?? "",
  // The name alone on a phone, in the row's second line. The number under it
  // and the picker are the table's; a page that needs the picker on a phone
  // moves this column to `status` (see the bank page's list of cardless rows).
  mobile: "meta",
  mobileCell: (tx) => tx.cardHolderName ?? null,
  sortable: true,
  searchable: true,
  // A fixed width, and the name truncated inside it. The table lays itself out
  // from what its cells hold, and this cell changes what it holds on the bank
  // page: a name, the card picker, or a dash, and names of every length. Each
  // change re-shared the width between every column, so assigning one card
  // moved the whole table. 200px is the picker's 176 plus the cell's padding,
  // so nothing this column can draw is wider than the column.
  className: "w-50",
  // And a fixed height, for the same reason one row down. The name with its
  // number and the picker are both 32px, but the name sits in a
  // button that is inline by default, and an inline box on a line picks up
  // the line's descender space under it. Switching between the two changed
  // the row's height by those few pixels. A column box of exactly 32px holds
  // whichever it is, centred, and is the same height either way.
  //
  // From md only. On a phone the cell is an item in the row's line of small
  // text (see DataTable's mobile card), and a 36px box there stood out of the
  // line into the rows around it.
  cell: (tx) => (
    <div className="flex flex-col justify-center md:h-8">
      {cell ? cell(tx) : <BankCardHolder tx={tx} />}
    </div>
  ),
});

// Money the way the app sets money everywhere else: `Amount`, not a flat
// string (see DESIGN.md).
//
// Deliberately *not* `signed`. On a bank statement a negative amount is the
// ordinary case, money left the account, and colouring every purchase red
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
 * The utlägg this purchase was accounted for as, as a link to it. The one
 * place on the bank table that answers "has this been dealt with, and by
 * what".
 *
 * `linked` names a match that has no reference yet: an utlägg is only numbered
 * when it is submitted for attest (see lib/domain/reference.ts), so a purchase
 * someone is still filling in is genuinely accounted for and genuinely has
 * nothing to be called. It still links. That half-finished utlägg is exactly
 * what a reader following this column wants to find.
 *
 * `unmatched` draws a row that has no utlägg yet, for a page that can offer to
 * make one there ("Redovisa"). It is the same question, has this been dealt
 * with, so its answer belongs in the same cell: a link where it has, the way to
 * do it where it hasn't. Where it draws nothing, the cell is empty.
 */
export const bankMatchedColumn = (
  header: string,
  { linked, unmatched }: { linked: string; unmatched: (tx: BankTransaction) => ReactNode },
): Column<BankTransaction> => ({
  key: "matched",
  header,
  // Sorted and searched on what the reader sees, not on the id behind the link.
  value: (tx) => tx.matchedExpenseRef ?? (tx.matchedExpenseId ? linked : ""),
  sortable: true,
  searchable: true,
  align: "right",
  className: "whitespace-nowrap tabular-nums",
  cell: (tx) =>
    tx.matchedExpenseId ? (
      <Link
        href={`/expenses/${tx.matchedExpenseId}`}
        className="font-medium text-accent underline decoration-faint underline-offset-2 hover:decoration-current"
      >
        {tx.matchedExpenseRef ?? linked}
      </Link>
    ) : (
      unmatched(tx)
    ),
});
