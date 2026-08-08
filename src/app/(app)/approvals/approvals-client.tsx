"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { DataTable, type Column, type TabFilter } from "@/components/ui/data-table";
import { SegmentedControl, type SegOption } from "@/components/ui/segmented-control";
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

/**
 * The tab this page opens on.
 *
 * Declared once and read by both halves: the page hands it to `parseListQuery`
 * so the query it runs matches, and the client hands it to
 * `useUrlTableControls` so the tab drawn as active matches too. They used to
 * declare it separately — the page explicitly, the client by accident, through
 * DataTable falling back to its first option — and agreed only because the
 * first option happened to be this one.
 */
export const APPROVALS_DEFAULT_TAB = "PENDING";

type ScopeFilter = "MINE" | "ALL";

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

  const SCOPE_OPTS: SegOption<ScopeFilter>[] = useMemo(() => [
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
      title={showOwnOnly ? t("titleOwn") : t("titleAll")}
      description={showOwnOnly ? t("descriptionOwn") : t("descriptionAll")}
      action={
        canToggleScope && (
          <SegmentedControl
            options={SCOPE_OPTS}
            value={showOwnOnly ? "MINE" : "ALL"}
            onChange={(v) => controls.setView(v)}
          />
        )
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
