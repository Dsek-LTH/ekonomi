"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { ClientDataTable, type ClientTabFilter } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { useScopeSwitch, useTableControls, useUrlTab } from "@/lib/data/use-list-query";
import { formatSEK } from "@/lib/ui/format";
import type { SupplierInvoiceRow } from "@/lib/data/supplier-invoices";
import type { FiscalYear } from "@/lib/ui/fiscal-year";
import { DueLabel, InvoiceStatusPill, useInvoiceTitle } from "./invoice-bits";
import {
  INVOICE_TABS,
  invoiceDefaultTab,
  invoiceTabHolds,
  type InvoiceScope,
  type InvoiceTab,
} from "./scope";

// Invoices not yet fördelade have no due date and sort after dated ones.
const dueKey = (r: SupplierInvoiceRow) => r.dueDate || `9999-${r.receivedAt}`;

export function InvoicesClient({
  rows,
  scope,
  scopes,
  tab,
  fiscal,
}: {
  rows: SupplierInvoiceRow[];
  fiscal: FiscalYear | null;
  scope: InvoiceScope;
  scopes: InvoiceScope[];
  tab: InvoiceTab;
}) {
  const t = useTranslations("invoices");
  const title = useInvoiceTitle();
  const local = useTableControls({ tab, sortKey: "dueDate", sortDir: "asc" });
  // The table keeps its stage in state, so a new scope must be handed the URL's stage.
  const [shownScope, setShownScope] = useState(scope);
  if (shownScope !== scope) {
    setShownScope(scope);
    local.setTab(tab);
  }
  const controls = useUrlTab(local, invoiceDefaultTab(scope));
  const setScope = useScopeSwitch(controls.tab, (s) => invoiceDefaultTab(s as InvoiceScope));

  // Counts use the same test as the nav (lib/data/nav-counts.ts).
  const tabs: ClientTabFilter<SupplierInvoiceRow> = useMemo(
    () =>
      INVOICE_TABS.map((value) => {
        const holds = invoiceTabHolds(value, fiscal);
        const waiting =
          value === "all" ? 0 : rows.filter((r) => r.waitsOnViewer && holds(r)).length;
        return {
          value,
          label: t(`tab.${value}`),
          predicate: holds,
          badge: waiting || undefined,
          waiting: true,
        };
      }),
    [t, fiscal, rows],
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
      value: dueKey,
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
        <ClientDataTable
          columns={columns}
          rows={rows}
          controls={controls}
          tabs={tabs}
          searchPlaceholder={t("searchPlaceholder")}
          rowKey={(r) => r.id}
          rowHref={(r) => `/invoices/${r.id}`}
          empty={rows.length === 0 ? t("empty") : t("noMatch")}
        />
      </Card>
    </PageShell>
  );
}
