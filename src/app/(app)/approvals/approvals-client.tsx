"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { DataTable, type Column, type TabFilter } from "@/components/ui/data-table";
import type { CollectionOption } from "@/components/ui/collection-switch";
import { useUrlTableControls } from "@/lib/data/use-list-query";
import {
  expenseAmountColumn,
  expenseDateColumn,
  expensePaymentTypeColumn,
  expenseReferenceColumn,
  expenseStatusColumn,
  expenseSubmitterColumn,
  expenseTitleColumn,
} from "@/components/columns/expense-columns";
import type { RowPage } from "@/lib/data/list-query";
import type { Expense } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";
import { APPROVALS_DEFAULT_TAB } from "./tabs";

export function ApprovalsClient({
  page,
  canToggleScope,
  showOwnOnly,
}: {
  page: RowPage<Expense>;
  // Whether this viewer may see the whole section's attest queue and not only
  // their own. Decided on the server, where the roles are; when false the rows
  // above are already just their own, so the two branches below agree anyway.
  canToggleScope: boolean;
  /** Which of the two questions below the page asked. Decided on the server. */
  showOwnOnly: boolean;
}) {
  const t = useTranslations("approvals");
  const tCol = useTranslations("expenses.col");
  const tPayment = useTranslations("common.payment");
  const tList = useTranslations("expenses");
  const { date } = useFormat();
  const controls = useUrlTableControls(page.total, APPROVALS_DEFAULT_TAB);

  const SCOPE_OPTS: CollectionOption[] = useMemo(() => [
    { value: "MINE", label: t("scope.mine") },
    { value: "ALL", label: t("scope.all") },
  ], [t]);
  // Mine is authority — the allocations this viewer may sign. Alla is the queue
  // itself, everything that has been sent and not yet left the chain, whoever it
  // is waiting on. They are different questions, not a narrow and a wide cut of
  // one, and now each is asked of the database directly (ExpenseListScope
  // "attestable" / "attestChain") rather than filtered out of everything.
  const tabs: TabFilter = [
    { value: APPROVALS_DEFAULT_TAB, label: t("tab.pending") },
    { value: "ATTESTED", label: t("tab.approved") },
  ];

  const columns: Column<Expense>[] = [
    expenseReferenceColumn(tCol("verification")),
    expenseTitleColumn(tCol("title"), { reference: false }),
    expenseDateColumn(tCol("date"), date),
    expensePaymentTypeColumn(tCol("type"), (type) => tPayment(`${type}.label`)),
    expenseSubmitterColumn(tCol("submitter")),
    expenseStatusColumn(tCol("status")),
    expenseAmountColumn(tCol("amount")),
  ];

  return (
    <PageShell
      // Fixed, whichever scope is showing — see the note on the same field in
      // expenses-client.tsx. What "mine" and "alla" mean here is not a wide and
      // a narrow cut of one list but two different questions, so the track is
      // the one place that says which was asked.
      title={t("title")}
      description={t("description")}
      collections={
        canToggleScope
          ? {
              label: t("scopeLabel"),
              value: showOwnOnly ? "MINE" : "ALL",
              options: SCOPE_OPTS,
              onChange: (v) => controls.setView(v),
            }
          : undefined
      }
    >
      <Card>
        <DataTable
          columns={columns}
          rows={page.rows}
          controls={controls}
          tabs={tabs}
          searchPlaceholder={tList("searchPlaceholder")}
          rowKey={(e) => e.id}
          rowHref={(e) => `/expenses/${e.id}`}
          empty={tList("noMatch")}
        />
      </Card>
    </PageShell>
  );
}
