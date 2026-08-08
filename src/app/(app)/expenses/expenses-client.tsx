"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconPlus, IconCheck } from "@/components/ui/icons";
import { SegmentedControl, type SegOption } from "@/components/ui/segmented-control";
import { DataTable, type Column, type SelectFilter } from "@/components/ui/data-table";
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
import { EXPENSE_STATUSES } from "@/lib/domain/status";
import type { RowPage } from "@/lib/data/list-query";

import type { Expense } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";


type ScopeFilter = "MINE" | "ALL";

export function ExpensesClient({
  page,
  canToggleScope,
  showOwnOnly,
}: {
  page: RowPage<Expense>;
  canToggleScope: boolean;
  showOwnOnly: boolean;
}) {
  const t = useTranslations("expenses");
  const tPayment = useTranslations("common.payment");
  const tStatus = useTranslations("common.status");
  const { date } = useFormat();
  // The list's state lives in the URL, because the query behind it runs on the
  // server — see useUrlTableControls. `page.rows` is already the page.
  const controls = useUrlTableControls(page.total);

  // `t` is stable per locale, so these are built once rather than per render —
  // a fresh `columns` array would also defeat DataTable's memo.
  const SCOPE_OPTS: SegOption<ScopeFilter>[] = useMemo(() => [
    { value: "MINE", label: t("scope.mine") },
    { value: "ALL", label: t("scope.all") },
  ], [t]);

  // Replaces the old Pågående/Klara/Alla tabs. Those were one coarse cut of a
  // list whose whole point is where in the chain an utlägg has got to — "klara"
  // covered attesterat, bokfört and exporterat alike, and there was no way to
  // ask for one of them. Every status is offered here instead, several at a
  // time; picking none is the old "Alla".
  //
  // No predicates: these are names the server matches on (STATUS_TAB in
  // lib/data/expenses.ts), so the rows arrive already narrowed.
  const STATUS_FILTER: SelectFilter = useMemo(() => ({
    label: t("statusFilter.all"),
    options: EXPENSE_STATUSES.map((s) => ({ value: s, label: tStatus(s) })),
  }), [t, tStatus]);

  // "Nothing here at all" and "nothing matching what you asked for" are
  // different things and read differently. With the filtering done in the
  // database the row count alone can no longer tell them apart, so the question
  // is asked of the controls: an empty list nobody has narrowed is the first.
  // `view` is deliberately not in this — showing your own and having none is
  // still an empty list, not a fruitless search.
  const narrowed = Boolean(
    controls.query || controls.picks.length || controls.dateFrom || controls.dateTo,
  );

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
              value={showOwnOnly ? "MINE" : "ALL"}
              onChange={(v) => controls.setView(v)}
            />
          )}
          <ButtonLink href="/expenses/new">
            <IconPlus className="size-4" />
            {t("new")}
          </ButtonLink>
        </div>
      }
    >
      {page.total === 0 && !narrowed ? (
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
            rows={page.rows}
            controls={controls}
            filter={STATUS_FILTER}
            searchPlaceholder={t("searchPlaceholder")}
            rowKey={(e) => e.id}
            rowHref={(e) => `/expenses/${e.id}`}
            empty={t("noMatch")}
          />
        </Card>
      )}
    </PageShell>
  );
}
