"use client";

// The columns every expense list is built from. Expenses, To approve and
// Bookkeeping showed the same five columns, each with its own copy of the cell
// markup, the sort/search flags and the alignment classes, so a change to how
// an amount or a date reads had to be made three times. They're declared once
// here; a page picks the ones it wants, in the order it wants, and adds its own
// alongside them.
import { StatusPill } from "@/components/ui/status-pill";
import { PaymentTag } from "@/components/ui/payment-tag";
import type { Column } from "@/components/ui/data-table";
import { EXPENSE_STATUSES } from "@/lib/domain/status";

import { Amount } from "@/components/ui/amount";
import type { Expense } from "@/lib/domain/types";

// Each column also says where it lands in DataTable's phone card, so every
// expense list reads the same there too: the title is the headline, the amount
// sits opposite it, and date / submitter / status become the labelled lines
// underneath.
//
// Headers are passed in rather than translated here: these are called from
// column tables built outside a component, and the same column is headed
// differently per page ("Expense" on one list, "Submitted by" on another).
export const expenseDateColumn = (
  header: string,
  // The reader's date format, from useFormat() in the page that builds the
  // column. A factory called at module scope cannot ask for it itself.
  date: (iso: string) => string,
): Column<Expense> => ({
  key: "date",
  header,
  value: (e) => e.purchaseDate,
  sortable: true,
  dateRange: true,
  className: "whitespace-nowrap text-muted",
  // On a phone the second line is who and when, in that order.
  mobile: "meta",
  mobileOrder: 1,
  cell: (e) => date(e.purchaseDate),
});

// Title, with the reference and payment type as the second line. A list that
// gives either of those a column of its own (see expensePaymentTypeColumn and
// expenseReferenceColumn) leaves it out here rather than printing it twice; with
// neither, the cell is the title alone.
export const expenseTitleColumn = (
  header: string,
  { reference = true }: { reference?: boolean } = {},
): Column<Expense> => ({
  key: "title",
  header,
  value: (e) => e.title,
  sortable: true,
  searchable: true,
  // The title alone on a phone. The reference under it was a third line on a
  // row that has two, and it is on the utlägg the row opens.
  mobile: "title",
  mobileCell: (e) => e.title,
  cell: (e) => {
    // An utlägg that hasn't been submitted yet has no reference to show, so the
    // second line is whatever is left of it, possibly nothing, in which case
    // there is no second line rather than an empty one.
    const ref = reference ? e.reference : undefined;
    return (
      <>
        <p className="font-medium">{e.title}</p>
        {ref && <p className="mt-0.5 text-xs text-muted">{ref}</p>}
      </>
    );
  },
});

// The kind of utlägg: bought on the section card, paid privately and to be
// reimbursed, or driven. Sorted and searched by the label the reader sees, not
// the enum, which is why the label still has to be passed in even though the
// tag now looks it up itself: `value` is a plain string and runs outside React.
export const expensePaymentTypeColumn = (
  header: string,
  paymentLabel: (type: Expense["paymentType"]) => string,
): Column<Expense> => ({
  key: "paymentType",
  header,
  value: (e) => paymentLabel(e.paymentType),
  sortable: true,
  searchable: true,
  className: "whitespace-nowrap",
  // Not on a phone: the row there is what, how much, who, when and where it
  // has got to, and the payment type is on the utlägg the row opens.
  cell: (e) => <PaymentTag type={e.paymentType} compact />,
});

// The utlägg's own reference, "DEK26-0043", the number it is known by
// everywhere from the receipt envelope to the ledger. Not the Fortnox voucher
// label, which only exists after export and lives on the detail page.
//
// A dash until it has one: the number is handed out when the utlägg is
// submitted for attest, so anything still with its submitter shows nothing here.
export const expenseReferenceColumn = (header: string, dash = "-"): Column<Expense> => ({
  key: "reference",
  header,
  value: (e) => e.reference ?? "",
  sortable: true,
  searchable: true,
  className: "whitespace-nowrap tabular-nums text-muted",
  cell: (e) => e.reference ?? dash,
});

export const expenseSubmitterColumn = (header: string, hidden = false): Column<Expense> => ({
  key: "submitter",
  header,
  hidden,
  value: (e) => e.submitterName,
  sortable: true,
  searchable: true,
  className: "text-muted",
  mobile: "meta",
  cell: (e) => e.submitterName,
});

// Sorted by where the status sits in the chain, not by its label: the point of
// sorting a list by status is to see how far along things are, and alphabetical
// order (or, worse, the reader's language) says nothing about that.
export const expenseStatusColumn = (header: string): Column<Expense> => ({
  key: "status",
  header,
  value: (e) => EXPENSE_STATUSES.indexOf(e.status),
  sortable: true,
  // Opposite the second line on a phone, under the amount. Where an utlägg
  // has got to is the reason most people open this list at all, and a pill is
  // a shape you read at a glance.
  mobile: "status",
  cell: (e) => <StatusPill status={e.status} />,
});

export const expenseAmountColumn = (header: string): Column<Expense> => ({
  key: "amount",
  header,
  align: "right",
  value: (e) => e.grossAmount,
  sortable: true,
  mobile: "trailing",
  className: "whitespace-nowrap",
  cell: (e) => <Amount value={e.grossAmount} signed />,
});
