"use client";

import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { useUrlTableControls } from "@/lib/data/use-list-query";
import { DataTable, type Column, type TabFilter } from "@/components/ui/data-table";
import {
  expenseAmountColumn,
  expenseDateColumn,
  expensePaymentTypeColumn,
  expenseReferenceColumn,
  expenseStatusColumn,
  expenseSubmitterColumn,
  expenseTitleColumn,
} from "@/components/columns/expense-columns";
import { expenseLabel } from "@/lib/domain/reference";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import type { RowPage } from "@/lib/data/list-query";
import type { Expense, FortnoxStatus } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";

export default function BookkeepingClient({
  page,
  fortnox,
}: {
  page: RowPage<Expense>;
  fortnox: FortnoxStatus;
}) {
  const notify = useNotify();
  const t = useTranslations("bookkeeping");
  const tCol = useTranslations("expenses.col");
  const tList = useTranslations("expenses");
  const tExpense = useTranslations("expenses.mutations");
  const tPayment = useTranslations("common.payment");
  const { date } = useFormat();
  const controls = useUrlTableControls(page.total);
  const { pending, mutate } = useMutation();

  // No predicates: the tab value is a status the server filters on, and the
  // page arrives already narrowed to it. "Bokföring picks up where approval
  // ends" (approved, booked, exported) is likewise the page's query now
  // (ExpenseListScope "signed"), not a filter applied to everything.
  const tabs: TabFilter = [
    { value: "all", label: t("tab.all") },
    { value: "APPROVED", label: t("tab.toBook") },
    { value: "BOOKED", label: t("tab.toExport") },
    { value: "EXPORTED", label: t("tab.exported") },
  ];
  // The OAuth round-trip's result is surfaced globally, see FortnoxAuthResult
  // in the app layout, since the callback can return to any page.

  // Keyed on the utlägg's id, spoken about by its reference. Anything
  // exportable has been through attest, so it has one.
  async function doExport(expense: Expense) {
    const id = expense.id;
    const name = expenseLabel(expense);
    const data = await mutate<{
      label: string;
      attachWarning: string | null;
      coverWarning: string | null;
    }>(`/api/expenses/${id}/export`, {
      key: id,
      error: t("exportFailed", { id: name }),
    });
    if (!data) return;
    const done = t("exportDone", { id: name, label: data.label });
    // The warning describes itself, so it's passed through verbatim.
    if (data.attachWarning) {
      notify.info(`${done}. ${tExpense("export.attachWarning", { detail: data.attachWarning })}`);
    }
    else notify.success(`${done}.`);
  }

  // The voucher is written under the bookkeeper's own Fortnox login, so an
  // export needs both the org's connection and a live personal session. Without
  // either the button stays visible but inert, and says which one is missing.
  const exportBlocked = !fortnox.connected
    ? t("connectFirst")
    : !fortnox.session
      ? t("loginFirst")
      : null;

  const columns: Column<Expense>[] = [
    expenseReferenceColumn(tCol("verification")),
    expenseTitleColumn(tCol("title"), { reference: false }),
    expenseDateColumn(tCol("date"), date),
    expensePaymentTypeColumn(tCol("type"), (type) => tPayment(`${type}.label`)),
    expenseSubmitterColumn(tCol("submitter")),
    expenseAmountColumn(tCol("amount")),
    expenseStatusColumn(tCol("status")),
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "actions",
      cell: (e) => (
        <div className="relative">
          {e.status === "APPROVED" && (
            <ButtonLink href={`/expenses/${e.id}/book`} size="sm">
              {t("book")}
            </ButtonLink>
          )}
          {e.status === "BOOKED" && (
            // A disabled control takes no pointer events, so the hint hangs on
            // the wrapper, otherwise it would never show on hover.
            <span title={exportBlocked ?? undefined}>
              <Button
                size="sm"
                loading={pending === e.id}
                disabled={exportBlocked !== null}
                aria-label={exportBlocked ?? undefined}
                onClick={() => doExport(e)}
              >
                {t("export")}
              </Button>
            </span>
          )}
          {e.status === "EXPORTED" && e.verification?.fortnoxLabel && (
            <span className="text-xs text-muted">{t("voucherLabel", { label: e.verification.fortnoxLabel })}</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageShell
      title={t("title")}
      description={t("description")}
    >
      <Card>
        <DataTable
          columns={columns}
          rows={page.rows}
          controls={controls}
          tabs={tabs}
          rowKey={(e) => e.id}
          rowHref={(e) => `/expenses/${e.id}`}
          empty={tList("noMatch")}
        />
      </Card>
    </PageShell>
  );
}
