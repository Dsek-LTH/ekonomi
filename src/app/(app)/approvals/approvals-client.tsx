"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { DataTable, type Column, type TabFilter } from "@/components/ui/data-table";
import { SegmentedControl, type SegOption } from "@/components/ui/segmented-control";
import { useTableControls } from "@/components/ui/table-controls";
import {
  expenseAmountColumn,
  expenseDateColumn,
  expensePaymentTypeColumn,
  expenseReferenceColumn,
  expenseStatusColumn,
  expenseSubmitterColumn,
  expenseTitleColumn,
} from "@/components/expense-columns";
import { isInAttestChain, isPendingApproval, isSigned } from "@/lib/domain/status";
import type { Expense } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";
import { useProgressRouter } from "@/components/shell/route-progress";

type ScopeFilter = "MINE" | "ALL";

export function ApprovalsClient({
  expenses,
  canToggleScope,
}: {
  expenses: Expense[];
  // Whether this viewer may see the whole section's attest queue and not only
  // their own. Decided on the server, where the roles are; when false the rows
  // above are already just their own, so the two branches below agree anyway.
  canToggleScope: boolean;
}) {
  const router = useProgressRouter();
  const t = useTranslations("approvals");
  const tCol = useTranslations("expenses.col");
  const tPayment = useTranslations("common.payment");
  const tList = useTranslations("expenses");
  const { date } = useFormat();
  const controls = useTableControls();

  const SCOPE_OPTS: SegOption<ScopeFilter>[] = useMemo(() => [
    { value: "MINE", label: t("scope.mine") },
    { value: "ALL", label: t("scope.all") },
  ], [t]);
  const [scope, setScope] = useState<ScopeFilter>("MINE");
  const showOwnOnly = !canToggleScope || scope === "MINE";

  // Mine is authority — the allocations this viewer may sign. Alla is the queue
  // itself, everything that has been sent and not yet left the chain, whoever it
  // is waiting on. They are different questions, not a narrow and a wide cut of
  // one, which is why neither is derived from the other.
  const rows = useMemo(
    () =>
      showOwnOnly
        ? expenses.filter((e) => e.allocations.some((a) => a.canAttest))
        : expenses.filter((e) => isInAttestChain(e.status)),
    [expenses, showOwnOnly],
  );

  const tabs: TabFilter<Expense> = [
    { value: "PENDING", label: t("tab.pending"), predicate: (e) => isPendingApproval(e.status) },
    { value: "ATTESTED", label: t("tab.approved"), predicate: (e) => isSigned(e.status) },
  ];

  const columns: Column<Expense>[] = [
    expenseDateColumn(tCol("date"), date),
    // As on the utlägg and bokföring lists: the reference and the payment type
    // get columns of their own here, so the title cell is just the title.
    expenseTitleColumn(tCol("title"), { reference: false }),
    expenseReferenceColumn(tCol("verification")),
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
            value={scope}
            onChange={(v) => { setScope(v); controls.setPage(0); }}
          />
        )
      }
    >
      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          controls={controls}
          tabs={tabs}
          searchPlaceholder={tList("searchPlaceholder")}
          rowKey={(e) => e.id}
          onRowClick={(e) => router.push(`/expenses/${e.id}`)}
          empty={tList("noMatch")}
        />
      </Card>
    </PageShell>
  );
}
