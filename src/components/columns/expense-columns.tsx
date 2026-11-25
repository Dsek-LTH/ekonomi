"use client";

// The columns every expense list is built from; a page picks and orders them and adds its own.
import { StatusPill } from "@/components/ui/status-pill";
import { PaymentGlyph, PaymentTag } from "@/components/ui/payment-tag";
import type { Column } from "@/components/ui/data-table";
import { EXPENSE_STATUSES } from "@/lib/domain/status";

import { Amount } from "@/components/ui/amount";
import { PersonName } from "@/components/ui/avatar";
import type { Expense } from "@/lib/domain/types";
import { cn } from "@/lib/ui/utils";

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

// Title with payment type and reference beside it. Each is `true` (always), `false` (the list
// gives it its own column) or "below-xl" (its own column is there only from xl, so the title
// carries it on narrower tables).
type SecondLine = boolean | "below-xl";

export const expenseTitleColumn = (
  header: string,
  {
    reference = true,
    paymentType = false,
  }: { reference?: SecondLine; paymentType?: SecondLine } = {},
): Column<Expense> => ({
  key: "title",
  header,
  // The column takes the width the others leave (w-full) and no more (max-w-0), so a long
  // title clips instead of widening the table.
  className: "w-full max-w-0",
  value: (e) => e.title,
  sortable: true,
  searchable: true,

  mobile: "title",
  mobileCell: (e) => e.title,
  // One line, so a row is one line high: the type as an icon before the title and the reference
  // after it, small and muted. The title is what gives when the row is short of room.
  cell: (e) => {
    // An utlägg not yet submitted has no reference.
    const ref = reference && e.reference;
    const narrow = (part: SecondLine) => (part === "below-xl" ? "xl:hidden" : undefined);
    return (
      <span className="flex min-w-0 items-center gap-2">
        {paymentType && <PaymentGlyph type={e.paymentType} className={narrow(paymentType)} />}
        <span className="min-w-0 truncate font-medium" title={e.title}>
          {e.title}
        </span>
        {ref && (
          <span className={cn("shrink-0 text-xs tabular-nums text-muted", narrow(reference))}>
            {ref}
          </span>
        )}
      </span>
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
  // On one line, so the column is as wide as the name ("David Mitterer Stråhle") rather than
  // squeezed by the title, which takes the spare width. A name past 14rem is clipped.
  className: "whitespace-nowrap text-muted",
  mobile: "meta",
  cell: (e) => <PersonName userId={e.submitterId} name={e.submitterName} className="max-w-56" />,
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
