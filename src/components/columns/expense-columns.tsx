"use client";

// The columns every expense list is built from; a page picks and orders them and adds its own.
import { StatusPill } from "@/components/ui/status-pill";
import { PaymentTag } from "@/components/ui/payment-tag";
import type { Column } from "@/components/ui/data-table";
import { EXPENSE_STATUSES } from "@/lib/domain/status";

import { Amount } from "@/components/ui/amount";
import { PersonName } from "@/components/ui/avatar";
import type { Expense } from "@/lib/domain/types";

// Each column says where it lands in DataTable's phone card (title headline, amount opposite,
// the rest labelled lines). Headers are passed in: built outside a component, headed differently per page.
export const expenseDateColumn = (
  header: string,
  // The reader's date format (useFormat()), since a module-scope factory cannot ask.
  date: (iso: string) => string,
): Column<Expense> => ({
  key: "date",
  header,
  value: (e) => e.purchaseDate,
  sortable: true,
  dateRange: true,
  className: "whitespace-nowrap text-muted",
  mobile: "meta",
  mobileOrder: 1,
  cell: (e) => date(e.purchaseDate),
});

// Title with reference and payment type as the second line; a list giving either its own
// column leaves it out here.
export const expenseTitleColumn = (
  header: string,
  { reference = true }: { reference?: boolean } = {},
): Column<Expense> => ({
  key: "title",
  header,
  value: (e) => e.title,
  sortable: true,
  searchable: true,

  mobile: "title",
  mobileCell: (e) => e.title,
  cell: (e) => {
    // An utlägg not yet submitted has no reference, so the second line may be empty.
    const ref = reference ? e.reference : undefined;
    return (
      <>
        <p className="font-medium">{e.title}</p>
        {ref && <p className="mt-0.5 text-xs text-muted">{ref}</p>}
      </>
    );
  },
});

// The kind of utlägg. Sorted and searched by the label the reader sees, so the label is
// still passed in (`value` is a plain string outside React).
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

  cell: (e) => <PaymentTag type={e.paymentType} compact />,
});

// The utlägg's own reference ("DEK26-0043"), not the Fortnox voucher label. A dash until it
// has one: it is handed out at submit for attest.
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
  cell: (e) => <PersonName userId={e.submitterId} name={e.submitterName} />,
});

// Sorted by position in the status chain, not by label.
export const expenseStatusColumn = (header: string): Column<Expense> => ({
  key: "status",
  header,
  value: (e) => EXPENSE_STATUSES.indexOf(e.status),
  sortable: true,

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
