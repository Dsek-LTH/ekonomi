"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyNote } from "@/components/ui/empty-state";
import { Tag } from "@/components/ui/status-pill";
import { IconPlus, IconChevronRight } from "@/components/ui/icons";
import { type Column } from "@/components/ui/data-table";
import { ClientDataTable } from "@/components/ui/client-data-table";
import { useTableControls } from "@/lib/data/use-list-query";
import {
  expenseAmountColumn,
  expenseDateColumn,
  expensePaymentTypeColumn,
  expenseReferenceColumn,
  expenseStatusColumn,
  expenseSubmitterColumn,
  expenseTitleColumn,
} from "@/components/columns/expense-columns";
import type { QueueAction, QueueItem } from "@/lib/domain/queue";

import type { Expense } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";

// The queue's action reuses the app's status colours rather than inventing a
// second language: purple is the authority chain, danger is "it came back",
// amber is "waiting on you", and the brand hue is the treasury's own work.
const ACTION_TONE: Record<QueueAction, React.ComponentProps<typeof Tag>["tone"]> = {
  FIX: "danger",
  SUBMIT: "neutral",
  MATCH: "warning",
  ATTEST: "purple",
  BOOK: "accent",
  EXPORT: "accent",
};

// A queue row is an utlägg plus the action it is waiting for, so the shared
// columns — declared over Expense, like every other list's — reach it one level
// down. Lifting them through `.expense` is what lets this table read exactly
// like /utlägg instead of keeping a second copy of the same cells here.
function onExpense(c: Column<Expense>): Column<QueueItem> {
  const value = c.value;
  return {
    ...c,
    cell: (i) => c.cell(i.expense),
    value: value && ((i: QueueItem) => value(i.expense)),
  };
}

export function DashboardClient({
  firstName,
  queue,
  mine,
}: {
  firstName: string;
  queue: QueueItem[];
  mine: Expense[];
}) {
  const t = useTranslations("dashboard");
  const tCol = useTranslations("expenses.col");
  const tList = useTranslations("expenses");
  const tPayment = useTranslations("common.payment");
  const { date } = useFormat();

  // Two tables on one page means two independent sets of sort/filter state.
  const queueControls = useTableControls();
  const mineControls = useTableControls();

  // Both tables carry the columns the utlägg, bokförings- and attestlistorna
  // carry, in their order: datum, utlägg, verifikat, typ, inlämnad av, status,
  // belopp. A row on the dashboard then says the same things about an utlägg as
  // the same row does on the list you land on when you click it.
  const queueColumns = useMemo<Column<QueueItem>[]>(
    () => [
      ...[
        expenseReferenceColumn(tCol("verification")),
        expenseTitleColumn(tCol("title"), { reference: false }),
        expenseDateColumn(tCol("date"), date),
        expensePaymentTypeColumn(tCol("type"), (type) => tPayment(`${type}.label`)),
        // The queue mixes your own utlägg with other people's, so who submitted
        // it is worth more here than on any of the lists it borrows from.
        expenseSubmitterColumn(tCol("submitter")),
      ].map(onExpense),
      {
        key: "action",
        // Stands where the status stands on the other lists, because it answers
        // the same question for this one. The queue shows the action, not the
        // status: the status is what the utlägg *is*, the action is what you are
        // being asked to do about it, and the action is derived from the status
        // — so showing both would say the same thing twice and bury the half
        // that matters here.
        header: t("actionHeader"),
        cell: (i) => <Tag tone={ACTION_TONE[i.action]}>{t(`action.${i.action}`)}</Tag>,
      },
      onExpense(expenseAmountColumn(tCol("amount"))),
    ],
    [t, tCol, tPayment, date],
  );

  const mineColumns = useMemo<Column<Expense>[]>(
    () => [
      expenseReferenceColumn(tCol("verification")),
      expenseTitleColumn(tCol("title"), { reference: false }),
      expenseDateColumn(tCol("date"), date),
      expensePaymentTypeColumn(tCol("type"), (type) => tPayment(`${type}.label`)),
      expenseStatusColumn(tCol("status")),
      expenseAmountColumn(tCol("amount")),
    ],
    [tCol, tPayment, date],
  );

  // Nothing waiting and nothing of your own: this person has not used the app
  // yet, so the page teaches instead of reporting zeroes at them.
  const isNewcomer = queue.length === 0 && mine.length === 0;

  return (
    <PageShell
      title={t("greeting", { name: firstName })}
    >
      {isNewcomer ? (
        <FirstRun />
      ) : (
        <>
          <Card>
            <CardHeader title={t("queueTitle")} />
            {queue.length ? (
              <ClientDataTable
                columns={queueColumns}
                rows={queue}
                controls={queueControls}
                searchPlaceholder={tList("searchPlaceholder")}
                rowKey={(i) => i.expense.id}
                rowHref={(i) => `/expenses/${i.expense.id}`}
                empty={tList("noMatch")}
              />
            ) : (
              <EmptyNote>{t("queueEmpty")}</EmptyNote>
            )}
          </Card>

          <Card>
            {/* Where "nytt utlägg" lives now that the page header carries only
                what this page is: on the card of your own utlägg, which is what
                a new one joins. In the header rather than on the table's
                toolbar below, because that table is not rendered at all when
                you have none — and having none is exactly when you want it. */}
            <CardHeader
              title={t("mineTitle")}
              action={
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href="/expenses"
                    className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
                  >
                    {t("allExpenses")}
                    <IconChevronRight className="size-4" />
                  </Link>
                  <ButtonLink href="/expenses/new" size="sm">
                    <IconPlus className="size-4" />
                    {t("newExpense")}
                  </ButtonLink>
                </div>
              }
            />
            {mine.length ? (
              <ClientDataTable
                columns={mineColumns}
                rows={mine}
                controls={mineControls}
                searchPlaceholder={tList("searchPlaceholder")}
                rowKey={(e) => e.id}
                rowHref={(e) => `/expenses/${e.id}`}
                empty={tList("noMatch")}
              />
            ) : (
              <EmptyNote>{t("mineEmpty")}</EmptyNote>
            )}
          </Card>
        </>
      )}
    </PageShell>
  );
}

// What a functionary who has never seen this app needs: not four zeroes, but
// the shape of the whole path and where their part of it ends. This doubles as
// the app's only help — there is no documentation anywhere else — which is why
// step four names the payout account, the thing that actually strands people.
function FirstRun() {
  const t = useTranslations("dashboard.firstRun");
  const steps = [1, 2, 3, 4] as const;

  return (
    <Card>
      <div className="px-inset py-8">
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="mt-2 max-w-prose text-[15px] text-muted">{t("lead")}</p>

        <ol className="mt-8 grid gap-6 sm:grid-cols-2">
          {steps.map((n) => (
            <li key={n} className="flex gap-4">
              {/* Numbered because the order is the information — this is a path,
                  not a feature list.
                  The four circles walk the brand ramp from pink to violet, so
                  the gradient is doing a job here rather than decorating: the
                  colour travels the same distance the utlägg does. color-mix
                  against the tokens rather than four fixed hexes, so the dark
                  theme's own endpoints apply. Every stop carries the near-black
                  label (worst 4.5:1 light, 6.7:1 dark). */}
              <span
                style={{
                  backgroundColor: `color-mix(in srgb, var(--color-brand-end) ${
                    ((n - 1) / (steps.length - 1)) * 100
                  }%, var(--color-brand))`,
                }}
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-on-brand"
              >
                {n}
              </span>
              <div className="min-w-0">
                <p className="font-medium">{t(`step${n}Title`)}</p>
                <p className="mt-1 text-sm text-muted">{t(`step${n}Body`)}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-8">
          <ButtonLink href="/expenses/new">
            <IconPlus className="size-4" />
            {t("cta")}
          </ButtonLink>
        </div>
      </div>
    </Card>
  );
}
