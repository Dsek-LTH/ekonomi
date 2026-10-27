"use client";

// Levfakturor, the archive: every invoice the reader may see, as a table, for
// finding the one from March. The daily work is the inbox (../inbox-client.tsx)
// or the one-at-a-time view; this is where to look something up.
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ClientDataTable, type ClientTabFilter } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { useTableControls } from "@/lib/data/use-list-query";
import { formatSEK } from "@/lib/ui/format";
import { useFormat } from "@/lib/ui/use-format";
import type { SupplierInvoiceRow } from "@/lib/data/supplier-invoices";
import type { SupplierInvoiceStatus } from "@/lib/domain/types";
import { InvoiceStatusPill, useInvoiceTitle } from "../invoice-bits";

const OPEN: SupplierInvoiceStatus[] = ["INBOX", "ASSIGNED", "PENDING_APPROVAL", "CHANGES_REQUESTED", "APPROVED"];

export function ArchiveClient({ rows }: { rows: SupplierInvoiceRow[] }) {
  const t = useTranslations("invoices");
  const { date } = useFormat();
  const title = useInvoiceTitle();
  const controls = useTableControls({ tab: "ALL", sortKey: "received", sortDir: "desc" });

  const tabs: ClientTabFilter<SupplierInvoiceRow> = useMemo(
    () => [
      { value: "ALL", label: t("tab.all") },
      { value: "OPEN", label: t("tab.open"), predicate: (r) => OPEN.includes(r.status) },
      { value: "EXPORTED", label: t("tab.exported"), predicate: (r) => r.status === "EXPORTED" },
    ],
    [t],
  );

  const columns: Column<SupplierInvoiceRow>[] = useMemo(
    () => [
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
        mobile: "meta",
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
        key: "received",
        header: t("col.received"),
        mobile: "meta",
        value: (r) => r.receivedAt.slice(0, 10),
        sortable: true,
        dateRange: true,
        cell: (r) => date(r.receivedAt.slice(0, 10)),
      },
      {
        key: "dueDate",
        header: t("col.dueDate"),
        mobile: "hide",
        value: (r) => r.dueDate,
        sortable: true,
        cell: (r) => (r.dueDate ? date(r.dueDate) : <span className="text-muted">-</span>),
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
          r.amount == null ? <span className="text-muted">-</span> : <span className="tabular-nums">{formatSEK(r.amount)}</span>,
      },
    ],
    [t, date, title],
  );

  return (
    <PageShell
      title={t("archive.title")}
      back="/invoices"
      aside={
        <ButtonLink href="/invoices" variant="secondary" size="sm">
          {t("archive.toInbox")}
        </ButtonLink>
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
