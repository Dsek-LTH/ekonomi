"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/status-pill";
import { DataTable, type Column, type TabFilter } from "@/components/ui/data-table";
import { useUrlTableControls } from "@/lib/data/use-list-query";
import { useFormat } from "@/lib/ui/use-format";
import {
  RENTAL_STATE_TONE,
  RENTAL_TABS,
  type RentalState,
} from "@/lib/contract/rental-state";
import type { RentalRow } from "@/lib/data/rentals";
import type { RowPage } from "@/lib/data/list-query";

export function RentalsClient({
  page,
  counts,
  canManage,
}: {
  page: RowPage<RentalRow>;
  counts: Record<RentalState, number>;
  canManage: boolean;
}) {
  const t = useTranslations("rentals");
  const { date } = useFormat();
  const controls = useUrlTableControls(page.total, "todo");

  // The count rides on the tab, so "what needs doing" is answerable without
  // opening it. Only on the two tabs where a number means work: "Alla" and
  // "Avslutade" are counts of history and would read as a backlog.
  const todo = counts.OVERDUE + counts.AWAITING_CHECK;
  const TABS: TabFilter = useMemo(
    () =>
      RENTAL_TABS.map((value) => ({
        value,
        label:
          value === "todo" && todo > 0
            ? `${t("tab.todo")} (${todo})`
            : t(`tab.${value === "" ? "all" : value}`),
      })),
    [t, todo],
  );

  const narrowed = Boolean(controls.query);

  const columns: Column<RentalRow>[] = useMemo(
    () => [
      {
        key: "title",
        header: t("col.what"),
        mobile: "title",
        cell: (r) => (
          <span>
            <span className="block font-medium">{r.title}</span>
            <span className="block text-xs text-muted">{r.counterparty}</span>
          </span>
        ),
      },
      {
        key: "period",
        mobile: "meta",
        header: t("col.period"),
        cell: (r) => (
          <span className="whitespace-nowrap text-muted">
            {t("period", { from: date(r.pickupAt), to: date(r.returnAt) })}
          </span>
        ),
      },
      {
        key: "returned",
        header: t("col.returned"),
        mobile: "hide",
        // What actually happened, beside what was agreed. A rental that came
        // back four days late is the row somebody is looking for, and it is
        // invisible unless both dates are on the page.
        cell: (r) =>
          r.returnedAt ? (
            <span className="whitespace-nowrap">
              {date(r.returnedAt)}
              {r.checkedAt === null && (
                <span className="ml-1 text-xs text-warning">{t("notChecked")}</span>
              )}
            </span>
          ) : (
            <span className="text-muted">-</span>
          ),
      },
      {
        key: "items",
        header: t("col.items"),
        align: "right",
        mobile: "meta",
        cell: (r) => <span className="text-muted">{t("itemCount", { count: r.lineCount })}</span>,
      },
      {
        key: "state",
        header: t("col.state"),
        mobile: "status",
        cell: (r) => <Tag tone={RENTAL_STATE_TONE[r.state]}>{t(`state.${r.state}`)}</Tag>,
      },
    ],
    [t, date],
  );

  return (
    <PageShell title={t("title")}>
      <Card>
        <DataTable
          columns={columns}
          rows={page.rows}
          controls={controls}
          tabs={TABS}
          action={
            canManage ? (
              <ButtonLink href="/contracts/rental/new" variant="accentOutline" size="sm">
                {t("new")}
              </ButtonLink>
            ) : undefined
          }
          searchPlaceholder={t("searchPlaceholder")}
          rowKey={(r) => r.id}
          // Through to the contract, which is the one page that describes this
          // row. A second detail screen showing the same rental from an
          // operational angle would be two pages disagreeing about one thing.
          rowHref={(r) => `/contracts/${r.id}`}
          empty={page.total === 0 && !narrowed && controls.tab === "" ? t("emptyTitle") : t("noMatch")}
        />
      </Card>
    </PageShell>
  );
}
