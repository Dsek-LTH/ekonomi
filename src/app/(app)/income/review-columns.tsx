"use client";

// The columns of the review queue's table view.
//
// Data, not markup: five column definitions and the button on each row. It
// was eighty lines in the middle of the component that draws the whole screen,
// and it is the same kind of thing components/columns/expense-columns.ts
// already keeps in a file of its own.
//
// The three things a column cannot work out for itself (what a day is called
// in the reader's language, where its cost centre comes from, and what opening
// a day does) arrive as arguments, so nothing here reaches back into the
// screen.
//
// An overview, and nothing is booked from it. Every day is reviewed against
// its intäktsräkning before it is booked, and a row here has no document
// beside it, so a row's one action is to open the day for review.
import { Amount } from "@/components/ui/amount";
import { Button } from "@/components/ui/button";
import type { Column } from "@/components/ui/data-table";
import { IconAlert } from "@/components/ui/icons";
import { Tag } from "@/components/ui/status-pill";
import type { IncomeReportRow } from "@/lib/data/income";
import type { IncomeSettingsRow } from "@/lib/data/income-config";
import { costCentreFor, isDuplicate } from "./voucher-draft";

/** The subset of next-intl's translator these columns ask for. */
type Translator = (key: string, values?: Record<string, string | number>) => string;

export function reviewColumns({
  t,
  settings,
  formatDate,
  onOpen,
}: {
  t: Translator;
  settings: IncomeSettingsRow;
  formatDate: (iso: string) => string;
  /** Show this day in the review column instead of the table. */
  onOpen: (report: IncomeReportRow) => void;
}): Column<IncomeReportRow>[] {
  return [
    {
      key: "date",
      mobile: "meta",
      mobileOrder: 1,
      header: t("table.date"),
      value: (r) => r.date,
      sortable: true,
      dateRange: true,
      className: "whitespace-nowrap",
      cell: (r) => formatDate(r.date),
    },
    {
      key: "unit",
      header: t("table.committee"),
      value: (r) => r.unitName ?? t("table.fees"),
      sortable: true,
      searchable: true,
      mobile: "title",
      cell: (r) => (
        <div className="min-w-0">
          <span className="flex items-center gap-1.5">
            {isDuplicate(r) && <IconAlert className="size-3.5 shrink-0 text-warning" />}
            <span className="font-medium">{r.unitName ?? t("table.fees")}</span>
          </span>
          <span className="block text-xs text-muted">
            {t(`source.${r.source}`)}
            {r.duplicateOf && ` - ${t("review.alreadyBookedShort")}`}
            {r.existingVoucher && ` - ${t("review.inFortnox", { voucher: r.existingVoucher })}`}
          </span>
        </div>
      ),
    },
    {
      key: "costCenter",
      mobile: "meta",
      header: t("table.costCenter"),
      value: (r) => costCentreFor(r, settings),
      sortable: true,
      searchable: true,
      className: "tabular-nums",
      cell: (r) => costCentreFor(r, settings) || <Tag tone="warning">{t("review.noCostCenter")}</Tag>,
    },
    {
      key: "total",
      header: t("table.total"),
      value: (r) => r.total,
      sortable: true,
      align: "right",
      mobile: "trailing",
      cell: (r) => <Amount value={r.total} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "actions",
      cell: (r) => (
        <Button size="sm" variant="secondary" onClick={() => onOpen(r)}>
          {t("review.open")}
        </Button>
      ),
    },
  ];
}
