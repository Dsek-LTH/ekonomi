"use client";

import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { useTableControls } from "@/components/ui/table-controls";
import { DataTable, type Column, type TabFilter } from "@/components/ui/data-table";
import {
  expenseAmountColumn,
  expenseDateColumn,
  expensePaymentTypeColumn,
  expenseReferenceColumn,
  expenseStatusColumn,
  expenseSubmitterColumn,
  expenseTitleColumn,
} from "@/components/expense-columns";
import { isSigned } from "@/lib/domain/status";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { stopClick } from "@/lib/ui/utils";
import type { Expense, FortnoxStatus } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";
import { useProgressRouter } from "@/components/shell/route-progress";

export default function BookkeepingClient({
  expenses,
  fortnox,
}: {
  expenses: Expense[];
  fortnox: FortnoxStatus;
}) {
  const router = useProgressRouter();
  const notify = useNotify();
  const t = useTranslations("bookkeeping");
  const tCol = useTranslations("expenses.col");
  const tList = useTranslations("expenses");
  const tExpense = useTranslations("expenses.mutations");
  const tPayment = useTranslations("common.payment");
  const { date } = useFormat();
  const controls = useTableControls();
  const { pending, mutate } = useMutation();

  const tabs: TabFilter<Expense> = [
    { value: "all", label: t("tab.all") },
    { value: "APPROVED", label: t("tab.toBook"), predicate: (e) => e.status === "APPROVED" },
    { value: "BOOKED", label: t("tab.toExport"), predicate: (e) => e.status === "BOOKED" },
    { value: "EXPORTED", label: t("tab.exported"), predicate: (e) => e.status === "EXPORTED" },
  ];
  // The OAuth round-trip's result is surfaced globally — see FortnoxAuthResult
  // in the app layout, since the callback can return to any page.

  // Bookkeeping picks up where approval ends: approved, booked, exported.
  const base = expenses.filter((e) => isSigned(e.status));

  async function doExport(id: string) {
    const data = await mutate(`/api/expenses/${id}/export`, {
      key: id,
      error: t("exportFailed", { id }),
    });
    if (!data) return;
    const done = t("exportDone", { id, label: String(data.label) });
    // The warning describes itself, so it's passed through verbatim.
    if (data.attachWarning) {
      notify.info(`${done}. ${tExpense("export.attachWarning", { detail: String(data.attachWarning) })}`);
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
        <div onClick={stopClick}>
          {e.status === "APPROVED" && (
            <ButtonLink href={`/expenses/${e.id}/book`} size="sm">
              {t("book")}
            </ButtonLink>
          )}
          {e.status === "BOOKED" && (
            // A disabled control takes no pointer events, so the hint hangs on
            // the wrapper — otherwise it would never show on hover.
            <span title={exportBlocked ?? undefined}>
              <Button
                size="sm"
                loading={pending === e.id}
                disabled={exportBlocked !== null}
                aria-label={exportBlocked ?? undefined}
                onClick={() => doExport(e.id)}
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
          rows={base}
          controls={controls}
          tabs={tabs}
          rowKey={(e) => e.id}
          onRowClick={(e) => router.push(`/expenses/${e.id}`)}
          empty={tList("noMatch")}
        />
      </Card>
    </PageShell>
  );
}
