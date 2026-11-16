"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { DataTable, type Column, type TabFilter } from "@/components/ui/data-table";
import { useScopeSwitch, useUrlTableControls } from "@/lib/data/use-list-query";
import type { RowPage } from "@/lib/data/list-query";
import { formatSEK } from "@/lib/ui/format";
import type { SupplierInvoiceRow } from "@/lib/data/supplier-invoices";
import { DueLabel, InvoiceStatusPill, useInvoiceTitle } from "./invoice-bits";
import { INVOICE_TABS, invoiceDefaultTab, type InvoiceScope, type InvoiceTab } from "./scope";

export function InvoicesClient({
  page,
  waiting,
  scope,
  scopes,
}: {
  /** One page, cut by the server (getInvoicePage). */
  page: RowPage<SupplierInvoiceRow>;
  /** What waits on the reader under each tab, for its pink count. See getInvoiceWaiting. */
  waiting: Partial<Record<InvoiceTab, number>>;
  scope: InvoiceScope;
  scopes: InvoiceScope[];
}) {
  const t = useTranslations("invoices");
  const title = useInvoiceTitle();
  // The list's state lives in the URL, because the query behind it runs on the server.
  const controls = useUrlTableControls(page.total, invoiceDefaultTab(scope));
  const setScope = useScopeSwitch(controls.tab, (s) => invoiceDefaultTab(s as InvoiceScope));

  const tabs: TabFilter = useMemo(
    () =>
      INVOICE_TABS.map((value) => ({
        value,
        label: t(`tab.${value}`),
        badge: value === "all" ? undefined : waiting[value] || undefined,
        waiting: true,
      })),
    [t, waiting],
  );

  const columns: Column<SupplierInvoiceRow>[] = [
    {
      key: "reference",
      header: t("col.reference"),
      mobile: "hide",
      value: (r) => r.reference ?? "",
      sortable: true,
      searchable: true,
      className: "whitespace-nowrap tabular-nums text-muted",
      cell: (r) => r.reference ?? "-",
    },
    {
      key: "description",
      header: t("col.description"),
      mobile: "title",
      value: (r) =>
        [
          r.description ?? "",
          r.supplierName ?? "",
          r.invoiceNumber ?? "",
          r.receivedByName ?? "",
        ].join(" "),
      sortable: true,
      searchable: true,
      cell: (r) =>
        r.description ? (
          <span className="block min-w-0">
            <span className="block truncate font-medium">{r.description}</span>
            {r.supplierName && (
              <span className="block truncate text-xs text-muted">{r.supplierName}</span>
            )}
          </span>
        ) : (
          <span className="block truncate text-muted">
            {r.receivedByName ? t("fromForwarder", { name: r.receivedByName }) : t("notAllocated")}
          </span>
        ),
      mobileCell: (r) => title(r),
    },
    {
      key: "unit",
      header: t("col.unit"),
      mobile: "meta",
      value: (r) => r.resultUnitName ?? "",
      sortable: true,
      searchable: true,
      cell: (r) => r.resultUnitName ?? <span className="text-muted">-</span>,
    },
    {
      key: "dueDate",
      header: t("col.dueDate"),
      mobile: "meta",
      value: (r) => r.dueDate,
      sortable: true,
      cell: (r) => <DueLabel dueDate={r.dueDate || null} />,
    },
    {
      key: "status",
      header: t("col.status"),
      mobile: "status",
      value: (r) => r.status,
      cell: (r) => <InvoiceStatusPill status={r.status} />,
    },
    {
      key: "amount",
      header: t("col.amount"),
      align: "right",
      mobile: "trailing",
      value: (r) => r.amount ?? 0,
      sortable: true,
      cell: (r) =>
        r.amount == null ? (
          <span className="text-muted">-</span>
        ) : (
          <span className="tabular-nums">{formatSEK(r.amount)}</span>
        ),
    },
  ];

  return (
    <PageShell
      title={t("title")}
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
      <Card>
        <DataTable
          columns={columns}
          rows={page.rows}
          controls={controls}
          tabs={tabs}
          searchPlaceholder={t("searchPlaceholder")}
          rowKey={(r) => r.id}
          rowHref={(r) => `/invoices/${r.id}`}
          // A search that found nothing reads differently from a tab with nothing in it.
          empty={controls.query ? t("noMatch") : t("empty")}
        />
      </Card>
    </PageShell>
  );
}
