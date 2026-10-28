"use client";

// Fakturor: every levfaktura the reader may see, the stage as a tab and whose
// as the scope switch, the same as Utlägg. Each row opens the invoice's own
// page, where the unit attests it and the treasurer completes it and exports
// it to Fortnox. See page.tsx.
//
// The rows arrive whole and are cut here (there are a few dozen open at a
// time), but the tab is still in the URL, so a link lands on the same stage.
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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

// Undated last when sorted soonest first: an invoice nobody has read a due
// date off yet is not more urgent than one due tomorrow.
const dueKey = (r: SupplierInvoiceRow) => r.dueDate || "9999-12-31";

export function InvoicesClient({
  rows,
  scope,
  scopes,
  tab,
  fiscal,
}: {
  rows: SupplierInvoiceRow[];
  /** The header's räkenskapsår, which narrows every tab. */
  fiscal: FiscalYear | null;
  /** Whose invoices these are, settled by the server. See page.tsx. */
  scope: InvoiceScope;
  scopes: InvoiceScope[];
  /** The stage in the URL, or the scope's own. */
  tab: InvoiceTab;
}) {
  const t = useTranslations("invoices");
  const title = useInvoiceTitle();
  const controls = useUrlTab(
    useTableControls({ tab, sortKey: "dueDate", sortDir: "asc" }),
    invoiceDefaultTab(scope),
  );
  const setScope = useScopeSwitch(controls.tab, (s) => invoiceDefaultTab(s as InvoiceScope));

  const tabs: ClientTabFilter<SupplierInvoiceRow> = useMemo(
    () =>
      INVOICE_TABS.map((value) => ({
        value,
        label: t(`tab.${value}`),
        predicate: invoiceTabHolds(value, fiscal),
      })),
    [t, fiscal],
  );

  const columns: Column<SupplierInvoiceRow>[] = [
    {
      key: "supplier",
      header: t("col.supplier"),
      mobile: "title",
      value: (r) => title(r),
      sortable: true,
      searchable: true,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium">{title(r)}</span>
          {r.supplierName && r.description && (
            <span className="block truncate text-xs text-muted">{r.description}</span>
          )}
        </span>
      ),
    },
    {
      key: "invoiceNumber",
      header: t("col.invoiceNumber"),
      mobile: "hide",
      value: (r) => r.invoiceNumber ?? "",
      searchable: true,
      cell: (r) => r.invoiceNumber ?? <span className="text-muted">-</span>,
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
      {rows.length === 0 ? (
        <EmptyState title={t("empty")} description={t("emptyDescription")} />
      ) : (
        <Card>
          <ClientDataTable
            columns={columns}
            rows={rows}
            controls={controls}
            tabs={tabs}
            searchPlaceholder={t("searchPlaceholder")}
            rowKey={(r) => r.id}
            rowHref={(r) => `/invoices/${r.id}`}
            empty={t("noMatch")}
          />
        </Card>
      )}
    </PageShell>
  );
}
