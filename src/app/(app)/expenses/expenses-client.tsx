"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { NewExpenseMenu } from "@/components/new-expense-menu";
import { Card } from "@/components/ui/card";
import { useReminderPicks } from "@/components/reminder-picks";
import { useRole } from "@/components/shell/role-context";
import { canRemindAboutExpense } from "@/lib/domain/reminders";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCheck } from "@/components/ui/icons";
import { DataTable, type Column, type TabFilter } from "@/components/ui/data-table";
import { ButtonLink } from "@/components/ui/button";
import { useScopeSwitch, useUrlTableControls } from "@/lib/data/use-list-query";
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
import { useBookingColumn } from "./booking-column";
import { EXPENSE_TABS, expenseDefaultTab, type ExpenseScope } from "./scope";


export function ExpensesClient({
  page,
  scope,
  scopes,
  reviewCount,
  canRemind,
}: {
  page: RowPage<Expense>;
  /** Whose utlägg these are, settled by the server. See page.tsx. */
  scope: ExpenseScope;
  /** The scopes this reader has, in the order the track draws them. */
  scopes: ExpenseScope[];
  /** Konterade utlägg this viewer may bokföra. See getReviewQueue. */
  reviewCount: number;
  /** Holds SEND_REMINDERS, so the rows can be ticked and reminded about. */
  canRemind: boolean;
}) {
  const t = useTranslations("expenses");
  const tBookkeeping = useTranslations("bookkeeping");
  const tPayment = useTranslations("common.payment");
  const { date } = useFormat();
  // The list's state lives in the URL, because the query behind it runs on the
  // server. See useUrlTableControls. `page.rows` is already the page.
  const defaultTab = expenseDefaultTab(scope);
  const controls = useUrlTableControls(page.total, defaultTab);
  const setScope = useScopeSwitch(controls.tab, (s) => expenseDefaultTab(s as ExpenseScope));
  const { user } = useRole();
  const showOwnOnly = scope === "mine";
  // What bookkeeping adds on the section's reading. See booking-column.tsx.
  const booking = useBookingColumn(scope === "all");

  // Bulk reminders: tick the utlägg, then "Påminn". See useReminderPicks.
  const picks = useReminderPicks({
    rows: page.rows,
    enabled: canRemind,
    subject: "expense",
    rowId: (e) => e.id,
    remindable: (e) => canRemindAboutExpense(e, user.id),
    rowLabel: (e) => e.reference ?? e.title,
  });

  // Stage is a tab, the same six on every scope, so a stage is where you left
  // it when you switch whose list you are reading. They replace a dropdown of
  // every status: that answered "which status" and nothing else, and stage is
  // a tab on every other list. The exact status is still in its column.
  //
  // No predicates: these are names the server matches on (STATUS_TAB in
  // lib/data/expenses.ts), so the rows arrive already narrowed.
  const tabs: TabFilter = useMemo(
    () => EXPENSE_TABS.map((value) => ({ value, label: t(`tab.${value}`) })),
    [t],
  );

  // "Nothing here at all" and "nothing matching what you asked for" are
  // different things and read differently. With the filtering done in the
  // database the row count alone can no longer tell them apart, so the question
  // is asked of the controls: an empty list nobody has narrowed is the first.
  // The scope is deliberately not in this. Showing your own and having none is
  // still an empty list, not a fruitless search. Only Mina draws it at all:
  // the other two are somebody else's work, and an empty one is just done.
  const narrowed = Boolean(
    controls.query || controls.dateFrom || controls.dateTo || controls.tab !== "all",
  );

  const columns: Column<Expense>[] = useMemo(() => [
    picks.column,
    expenseReferenceColumn(t("col.verification")),
    expenseTitleColumn(t("col.title"), { reference: false }),
    expenseDateColumn(t("col.date"), date),
    expensePaymentTypeColumn(t("col.type"), (type) => tPayment(`${type}.label`)),
    expenseSubmitterColumn(t("col.submitter"), showOwnOnly),
    expenseStatusColumn(t("col.status")),
    {
      key: "attest",
      header: t("col.attest"),
      // Off the phone row. It is a line per allocation (a tick, a name and a
      // cost centre each) which is a column of its own on a table and cannot
      // be a clause in a one-line summary. The same thing, laid out for a
      // narrow screen, is on the utlägg's own page under Fördelning.
      mobile: "hide",
      cell: (e) =>
        e.allocations.length === 0 ? (
          <span className="text-muted">-</span>
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
                          name: a.approvedByName ?? "-",
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
                    <span className="text-muted">{a.costCenterCode}</span>
                  )}
                </div>
              );
            })}
          </div>
        ),
    },
    expenseAmountColumn(t("col.amount")),
    ...(booking.column ? [booking.column] : []),
  ], [t, tPayment, showOwnOnly, date, picks.column, booking.column]);

  return (
    <PageShell
      // Fixed, whichever scope is showing: the track below says which of the
      // two you are on, and a heading that said it too would be the same word
      // twice on one screen.
      title={t("title")}
      // No description. The header wraps on a narrow screen, and a paragraph
      // between the title and the Mina/Alla track pushed the track onto a line
      // of its own well below the heading it belongs to. The two are meant to
      // read as one, and on the list you land on most often the sentence was
      // costing more than it said.

      collections={
        scopes.length > 1
          ? {
              label: t("scopeLabel"),
              value: scope,
              options: scopes.map((s) => ({ value: s, label: t(`scope.${s}`) })),
              onChange: setScope,
            }
          : undefined
      }
    >
      {showOwnOnly && page.total === 0 && !narrowed ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <NewExpenseMenu />
          }
        />
      ) : (
        <Card>
          <DataTable
            columns={columns}
            rows={page.rows}
            controls={controls}
            tabs={tabs}
            // On the list's own toolbar rather than in the page header: it adds
            // a row to what is below it, so that is where it lives.
            action={
              <>
                {picks.button}
                {reviewCount > 0 && (
                  <ButtonLink href="/expenses/review" variant="secondary">
                    {tBookkeeping("review.start", { count: reviewCount })}
                  </ButtonLink>
                )}
                {/* Filled: making an utlägg is the main thing this page is for,
                    so it is drawn as the page's primary action even on a bar it
                    shares with the search and the status filter. The empty
                    state's copy is filled too, so the two read as the same
                    button. */}
                <NewExpenseMenu variant="primary" />
              </>
            }
            searchPlaceholder={t("searchPlaceholder")}
            rowKey={(e) => e.id}
            rowHref={(e) => `/expenses/${e.id}`}
            empty={t("noMatch")}
          />
        </Card>
      )}

      {picks.dialog}
      {booking.dialog}
    </PageShell>
  );
}
