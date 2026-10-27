"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tag } from "@/components/ui/status-pill";
import { DataTable, type Column, type SelectFilter, type TabFilter } from "@/components/ui/data-table";
import { useUrlTableControls } from "@/lib/data/use-list-query";
import { useFormat } from "@/lib/ui/use-format";
import { CONTRACT_STATUS_TONE, CONTRACT_TABS, displayStatus } from "@/lib/contract/status";
import type { ContractSummary } from "@/lib/data/contracts";
import type { RowPage } from "@/lib/data/list-query";
import type { ContractKind } from "@/lib/domain/types";

const KINDS: readonly ContractKind[] = ["CONTRACT", "PROTOCOL", "OTHER"];

export function ContractsClient({
  page,
  today,
  canManage,
}: {
  page: RowPage<ContractSummary>;
  today: string;
  canManage: boolean;
}) {
  const t = useTranslations("contracts");
  const { date } = useFormat();
  const controls = useUrlTableControls(page.total);

  const TABS: TabFilter = useMemo(
    () => CONTRACT_TABS.map((value) => ({ value, label: t(`tab.${value === "" ? "" : value}`) })),
    [t],
  );

  const KIND_FILTER: SelectFilter = useMemo(
    () => ({
      label: t("kindFilter.all"),
      options: KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) })),
    }),
    [t],
  );

  // "Nothing here at all" and "nothing matching what you asked for" read
  // differently, and with the filtering done in Postgres the row count cannot
  // tell them apart on its own. The same question the utlägg list asks.
  const narrowed = Boolean(
    controls.query || controls.picks.length || controls.dateFrom || controls.dateTo || controls.tab,
  );

  // How a contract's period reads in one cell. Four cases rather than a range
  // with dashes standing in for the missing halves: an archived contract often
  // states one end or neither, and "- 2027-06-30" makes a reader work out which
  // end is missing.
  //
  // A lean document (PROTOCOL/OTHER) has no period to state, only the one
  // date it was filed under, so the same cell reads that instead: it is the
  // same question, "when is this", the column already asks.
  const validity = useCallback(
    (c: ContractSummary): string => {
      if (c.kind !== "CONTRACT") return c.date ? date(c.date) : t("validity.none");
      if (c.validFrom && c.validTo) {
        return t("validity.range", { from: date(c.validFrom), to: date(c.validTo) });
      }
      if (c.validFrom) return t("validity.fromOnly", { from: date(c.validFrom) });
      if (c.validTo) return t("validity.toOnly", { to: date(c.validTo) });
      return t("validity.none");
    },
    [t, date],
  );

  const columns: Column<ContractSummary>[] = useMemo(
    () => [
      {
        key: "title",
        header: t("col.title"),
        mobile: "title",
        cell: (c) => <span className="font-medium">{c.title}</span>,
      },
      {
        key: "counterparty",
        mobile: "meta",
        header: t("col.counterparty"),
        cell: (c) => c.counterparty ?? <span className="text-muted">-</span>,
      },
      {
        key: "kind",
        mobile: "hide",
        header: t("col.kind"),
        cell: (c) => <span className="text-muted">{t(`kind.${c.kind}`)}</span>,
      },
      {
        key: "validity",
        header: t("col.validity"),
        // Off the phone card: it is the longest thing on the row and the
        // status pill beside it already says whether the contract still runs.
        mobile: "hide",
        cell: (c) => <span className="whitespace-nowrap text-muted">{validity(c)}</span>,
      },
      {
        key: "tags",
        header: t("col.tags"),
        mobile: "hide",
        cell: (c) =>
          c.tags.length === 0 ? (
            <span className="text-muted">-</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {c.tags.map((tag) => (
                // A neutral Tag rather than a Chip: a Chip is a control you
                // toggle, and these are labels. Clicking one filters nothing.
                <Tag key={tag}>{tag}</Tag>
              ))}
            </span>
          ),
      },
      {
        key: "status",
        header: t("col.status"),
        mobile: "status",
        cell: (c) => {
          // Derived against the page's one `today`, so every row on the screen
          // is judged on the same day. Null for PROTOCOL/OTHER, which carry
          // no status at all: filed or it doesn't exist.
          const status = displayStatus(c, today);
          if (status === null) return <span className="text-muted">-</span>;
          return <Tag tone={CONTRACT_STATUS_TONE[status]}>{t(`status.${status}`)}</Tag>;
        },
      },
      {
        key: "files",
        header: t("col.files"),
        align: "right",
        mobile: "meta",
        // A filed contract with no document yet is a real state, and saying so
        // is more use than an empty cell.
        cell: (c) => <span className="text-muted">{t("fileCount", { count: c.fileCount })}</span>,
      },
    ],
    [t, today, validity],
  );

  const actions = canManage ? (
    <div className="flex gap-2">
      <ButtonLink href="/contracts/rental/new" variant="accentOutline" size="sm">
        {t("drawRental")}
      </ButtonLink>
      <ButtonLink href="/contracts/upload" variant="secondary" size="sm">
        {t("uploadExisting")}
      </ButtonLink>
    </div>
  ) : undefined;

  return (
    <PageShell title={t("title")}>
      {page.total === 0 && !narrowed ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            canManage ? (
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href="/contracts/rental/new">{t("drawRental")}</ButtonLink>
                <ButtonLink href="/contracts/upload" variant="secondary">
                  {t("uploadExisting")}
                </ButtonLink>
              </div>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <DataTable
            columns={columns}
            rows={page.rows}
            controls={controls}
            tabs={TABS}
            filter={KIND_FILTER}
            action={actions}
            searchPlaceholder={t("searchPlaceholder")}
            rowKey={(c) => c.id}
            rowHref={(c) => `/contracts/${c.id}`}
            empty={t("noMatch")}
          />
        </Card>
      )}
    </PageShell>
  );
}
