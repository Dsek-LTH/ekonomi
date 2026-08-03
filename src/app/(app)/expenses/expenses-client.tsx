"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconPlus, IconCheck } from "@/components/ui/icons";
import { SegmentedControl, type SegOption } from "@/components/ui/segmented-control";
import { DataTable, type Column, type SelectFilter } from "@/components/ui/data-table";
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
import { useRole } from "@/components/shell/role-context";
import { canAccessBookkeeping, hasAttestRole } from "@/lib/domain/permissions";
import { EXPENSE_STATUSES } from "@/lib/domain/status";

import type { Expense } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";
import { useProgressRouter } from "@/components/shell/route-progress";


type ScopeFilter = "MINE" | "ALL";

export function ExpensesClient({
  expenses: allExpenses,
}: {
  expenses: Expense[];
}) {
  const t = useTranslations("expenses");
  const tPayment = useTranslations("common.payment");
  const tStatus = useTranslations("common.status");
  const router = useProgressRouter();
  const { user } = useRole();
  const { date } = useFormat();
  const controls = useTableControls();

  // `t` is stable per locale, so these are built once rather than per render —
  // a fresh `columns` array would also defeat DataTable's filter/sort memo.
  const SCOPE_OPTS: SegOption<ScopeFilter>[] = useMemo(() => [
    { value: "MINE", label: t("scope.mine") },
    { value: "ALL", label: t("scope.all") },
  ], [t]);
  // Anyone who sees more than their own utlägg (bookkeeping or attest roles) can
  // switch between their own and everything they're allowed to see (default: own).
  const canToggleScope = canAccessBookkeeping(user.roles) || hasAttestRole(user.roles);
  const [scope, setScope] = useState<ScopeFilter>("MINE");
  const showOwnOnly = !canToggleScope || scope === "MINE";

  const base = showOwnOnly ? allExpenses.filter((e) => e.submitterId === user.id) : allExpenses;

  // Replaces the old Pågående/Klara/Alla tabs. Those were one coarse cut of a
  // list whose whole point is where in the chain an utlägg has got to — "klara"
  // covered attesterat, bokfört and exporterat alike, and there was no way to
  // ask for one of them. Every status is offered here instead, several at a
  // time; picking none is the old "Alla".
  const STATUS_FILTER: SelectFilter<Expense> = useMemo(() => ({
    label: t("statusFilter.all"),
    options: EXPENSE_STATUSES.map((s) => ({
      value: s,
      label: tStatus(s),
      predicate: (e: Expense) => e.status === s,
    })),
  }), [t, tStatus]);

  const columns: Column<Expense>[] = useMemo(() => [
    expenseReferenceColumn(t("col.verification")),
    expenseTitleColumn(t("col.title"), { reference: false }),
    expenseDateColumn(t("col.date"), date),
    expensePaymentTypeColumn(t("col.type"), (type) => tPayment(`${type}.label`)),
    expenseSubmitterColumn(t("col.submitter"), showOwnOnly),
    expenseStatusColumn(t("col.status")),
    {
      key: "attest",
      header: t("col.attest"),
      cell: (e) =>
        e.allocations.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <div className="space-y-0.5">
            {e.allocations.map((a) => {
              const attested = !!a.approvedById;
              return (
                <div
                  key={a.id}
                  className="flex items-center gap-1.5 whitespace-nowrap text-xs"
                  title={
                    attested
                      ? t("attest.attestedBy", {
                          name: a.approvedByName ?? "—",
                          date: a.approvedAt ? ` ${date(a.approvedAt)}` : "",
                        })
                      : t("attest.waitingResultUnit", {
                          resultUnit: a.resultUnit ?? t("attest.noResultUnit"),
                        })
                  }
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center">
                    {attested ? (
                      <IconCheck className="size-3.5 text-success" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-muted/40" />
                    )}
                  </span>
                  <span className={attested ? "font-medium" : "text-muted"}>
                    {attested ? a.approvedByName : (a.resultUnit ?? t("attest.waiting"))}
                  </span>
                  {e.allocations.length > 1 && (
                    <span className="text-muted/60">{a.costCenterCode}</span>
                  )}
                </div>
              );
            })}
          </div>
        ),
    },
    expenseAmountColumn(t("col.amount")),
  ], [t, tPayment, showOwnOnly, date]);

  return (
    <PageShell
      title={showOwnOnly ? t("titleOwn") : t("titleAll")}
      description={t("description")}
      action={
        <div className="flex flex-wrap items-center gap-3">
          {canToggleScope && (
            <SegmentedControl
              options={SCOPE_OPTS}
              value={scope}
              onChange={(v) => { setScope(v); controls.setPage(0); }}
            />
          )}
          <ButtonLink href="/expenses/new">
            <IconPlus className="size-4" />
            {t("new")}
          </ButtonLink>
        </div>
      }
    >
      {base.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <ButtonLink href="/expenses/new">
              <IconPlus className="size-4" />
              {t("new")}
            </ButtonLink>
          }
        />
      ) : (
        <Card>
          <DataTable
            columns={columns}
            rows={base}
            controls={controls}
            filter={STATUS_FILTER}
            searchPlaceholder={t("searchPlaceholder")}
            rowKey={(e) => e.id}
            onRowClick={(e) => router.push(`/expenses/${e.id}`)}
            empty={t("noMatch")}
          />
        </Card>
      )}
    </PageShell>
  );
}
