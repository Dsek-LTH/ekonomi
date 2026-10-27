"use client";

// Levfakturor, as one list with tabs. "Att göra" first, because the page is
// opened to do something: sort the inkorg, kontera what was given to you, sign
// what is waiting for your attest. Everything else is the record.
//
// Uploading by hand sits on the table's toolbar, the way every list's create
// button does, and goes straight to the new invoice: an invoice with nothing
// filled in is not worth looking at in a list.
import { useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tag } from "@/components/ui/status-pill";
import { IconUpload } from "@/components/ui/icons";
import { ClientDataTable, type ClientTabFilter } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import { useMutation } from "@/components/shell/use-mutation";
import { useProgressRouter } from "@/components/shell/route-progress";
import { useTableControls } from "@/lib/data/use-list-query";
import { INVOICE_STATUS_TONE } from "@/lib/domain/supplier-invoice";
import { formatSEK } from "@/lib/ui/format";
import { useFormat } from "@/lib/ui/use-format";
import type { InboxHealth, SupplierInvoiceRow } from "@/lib/data/supplier-invoices";
import type { SupplierInvoiceStatus } from "@/lib/domain/types";

const ACTIVE: SupplierInvoiceStatus[] = ["ASSIGNED", "PENDING_APPROVAL", "CHANGES_REQUESTED"];
const DONE: SupplierInvoiceStatus[] = ["APPROVED", "EXPORTED"];

export function InvoiceStatusPill({ status }: { status: SupplierInvoiceStatus }) {
  const t = useTranslations("common.invoiceStatus");
  return <Tag tone={INVOICE_STATUS_TONE[status]}>{t(status)}</Tag>;
}

export function InvoicesClient({
  rows,
  canTriage,
  health,
}: {
  rows: SupplierInvoiceRow[];
  canTriage: boolean;
  /** The mailbox's state. Null for anyone but triage. */
  health: InboxHealth | null;
}) {
  const t = useTranslations("invoices");
  const { date } = useFormat();
  const router = useProgressRouter();
  const upload = useMutation();
  const picker = useRef<HTMLInputElement>(null);
  const controls = useTableControls({ tab: "TODO" });

  async function onFile(file: File) {
    const form = new FormData();
    form.append("file", file);
    const created = await upload.mutate<{ id: string }>("/api/supplier-invoices", {
      body: form,
      refresh: false,
    });
    if (created) router.push(`/invoices/${created.id}`);
  }

  const tabs: ClientTabFilter<SupplierInvoiceRow> = useMemo(
    () => [
      { value: "TODO", label: t("tab.todo"), predicate: (r) => r.waitsOnViewer },
      ...(canTriage
        ? [{ value: "INBOX", label: t("tab.inbox"), predicate: (r: SupplierInvoiceRow) => r.status === "INBOX" }]
        : []),
      { value: "ACTIVE", label: t("tab.active"), predicate: (r) => ACTIVE.includes(r.status) },
      { value: "DONE", label: t("tab.done"), predicate: (r) => DONE.includes(r.status) },
      ...(canTriage
        ? [
            {
              value: "DISCARDED",
              label: t("tab.discarded"),
              predicate: (r: SupplierInvoiceRow) => r.status === "DISCARDED",
            },
          ]
        : []),
      { value: "ALL", label: t("tab.all") },
    ],
    [t, canTriage],
  );

  const columns: Column<SupplierInvoiceRow>[] = useMemo(
    () => [
      {
        key: "supplier",
        header: t("col.supplier"),
        mobile: "title",
        value: (r) => r.supplierName ?? "",
        sortable: true,
        searchable: true,
        cell: (r) => (
          <span className="block min-w-0">
            <span className="block truncate font-medium">
              {r.supplierName ?? <span className="text-muted italic">{t("unnamed")}</span>}
            </span>
            {r.description && (
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
        key: "dueDate",
        header: t("col.dueDate"),
        mobile: "meta",
        value: (r) => r.dueDate,
        sortable: true,
        dateRange: true,
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
          r.amount == null ? (
            <span className="text-muted">-</span>
          ) : (
            <span className="tabular-nums">{formatSEK(r.amount)}</span>
          ),
      },
    ],
    [t, date],
  );

  const uploadButton = canTriage ? (
    <>
      <input
        ref={picker}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void onFile(file);
        }}
      />
      <Button
        size="sm"
        variant="accentOutline"
        loading={upload.busy}
        onClick={() => picker.current?.click()}
      >
        <IconUpload className="size-4" />
        {t("upload")}
      </Button>
    </>
  ) : undefined;

  return (
    <PageShell title={t("title")}>
      {rows.length === 0 ? (
        <EmptyState
          title={t("empty")}
          description={canTriage ? t("emptyTriage") : t("emptyDescription")}
          action={uploadButton}
        />
      ) : (
        <Card>
          <ClientDataTable
            columns={columns}
            rows={rows}
            controls={controls}
            tabs={tabs}
            action={uploadButton}
            searchPlaceholder={t("searchPlaceholder")}
            rowKey={(r) => r.id}
            rowHref={(r) => `/invoices/${r.id}`}
            empty={t("noMatch")}
          />
        </Card>
      )}

      {health?.enabled && <MailboxCard health={health} />}
    </PageShell>
  );
}

/**
 * The inkorg mailbox, at the foot of triage's list: when it was last read, the
 * error if the last read failed, and the mail it refused lately. A forward that
 * "never arrived" is usually here, refused for coming from a private address.
 */
function MailboxCard({ health }: { health: InboxHealth }) {
  const t = useTranslations("invoices.mailbox");
  const { dateTime } = useFormat();
  return (
    <Card>
      <div className="space-y-3 px-inset py-4 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t("title")}</h2>
          <span className="text-xs text-muted">
            {health.lastSyncAt ? t("lastSync", { when: dateTime(health.lastSyncAt) }) : t("neverSynced")}
          </span>
        </div>
        {health.lastError && <p className="text-danger">{t("error", { error: health.lastError })}</p>}
        {health.rejected.length === 0 ? (
          <p className="text-muted">{t("noneRejected")}</p>
        ) : (
          <>
            <p className="text-muted">{t("rejectedLead")}</p>
            <ul className="divide-y divide-border">
              {health.rejected.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5">
                  <span className="min-w-0 truncate">
                    {r.fromAddress || t("unknownSender")}
                    {r.subject && <span className="text-muted"> - {r.subject}</span>}
                  </span>
                  <span className="text-xs text-muted">
                    {r.reason ? t(`reason.${r.reason}`) : ""} - {dateTime(r.receivedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
