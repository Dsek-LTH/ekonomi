"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { Tag } from "@/components/ui/status-pill";
import { Combobox } from "@/components/ui/combobox";
import { ClampedText } from "@/components/ui/clamped-text";
import { IconButton } from "@/components/ui/icon-button";
import { IconInvoice, IconMail, IconTrash, IconUpload } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { ViewToggle } from "@/components/ui/view-toggle";
import { ClientDataTable, visibleRows } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import {
  ReceiptPanelCover,
  ReceiptPanelFooter,
  ReceiptPanelSource,
} from "@/components/receipt/receipt-panel";
import { useQuery } from "@/components/shell/use-query";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { useProgressRouter } from "@/components/shell/route-progress";
import { useTableControls } from "@/lib/data/use-list-query";
import { useFormat } from "@/lib/ui/use-format";
import { DateInput } from "@/components/ui/field";
import { isCompleteDate } from "@/lib/domain/date";
import { LABEL } from "@/components/record-card";
import type { InboxDocument } from "@/lib/data/invoice-inbox";
import type { InboxHealth } from "@/lib/data/supplier-invoices";

const HOME = "/invoices/inbox";

export function InkorgClient({
  documents,
  resultUnits,
  health,
  triage,
  canConnectMailbox,
}: {
  documents: InboxDocument[];
  resultUnits: { id: string; name: string }[];
  health: InboxHealth | null;
  triage: boolean;
  canConnectMailbox: boolean;
}) {
  const t = useTranslations("invoices.inkorg");
  // The document open in the panel. Page state, not the URL: on a phone the viewer is open exactly while one is picked.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = documents.find((d) => d.id === selectedId) ?? null;
  const upload = useUpload(selectedId, setSelectedId);
  const remover = useMutation();
  const confirm = useConfirm();
  const { dateTime } = useFormat();
  const controls = useTableControls({ sortKey: "received", sortDir: "asc" });
  const rows = documents;
  // Which the panel shows, the PDF or the mail. Each document opens on its PDF.
  const [view, setView] = useState<{ id: string | null; mode: PanelView }>({
    id: null,
    mode: "pdf",
  });
  const mode: PanelView = selected?.mailed && view.id === selectedId ? view.mode : "pdf";

  // Next in the table once this one is dealt with. The caller refreshes the list.
  const advance = (id: string) => {
    const shown = visibleRows({ columns, rows, controls });
    const i = shown.findIndex((d) => d.id === id);
    const next = i === -1 ? undefined : (shown[i + 1] ?? shown[i - 1]);
    setSelectedId(next?.id ?? null);
  };

  async function remove(d: InboxDocument) {
    const ok = await confirm({
      title: t("delete"),
      message: t("deleteConfirm", { name: d.filename }),
      confirmLabel: t("delete"),
      tone: "danger",
    });
    if (!ok) return;
    const res = await remover.mutate(`/api/supplier-invoice-documents/${d.id}`, {
      key: d.id,
      method: "DELETE",
      success: t("deleted"),
    });
    if (res && d.id === selectedId) advance(d.id);
  }

  const columns: Column<InboxDocument>[] = [
    {
      key: "document",
      header: t("col.document"),
      mobile: "title",
      value: (d) => [d.filename, d.subject ?? "", d.note ?? ""].join(" "),
      sortable: true,
      searchable: true,
      className: "max-w-80",
      cell: (d) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{d.filename}</span>
          {d.returned && (
            <Tag tone="danger" className="shrink-0">
              {t("returnedTag")}
            </Tag>
          )}
        </span>
      ),
      mobileCell: (d) => d.filename,
    },
    {
      key: "from",
      header: t("col.from"),
      mobile: "meta",
      value: (d) => d.fromName ?? d.fromAddress ?? "",
      sortable: true,
      searchable: true,
      cell: (d) => (
        <span className="block truncate">
          {d.fromName ?? d.fromAddress ?? (
            <span className="text-muted">{t("uploadedByUnknown")}</span>
          )}
        </span>
      ),
    },
    {
      key: "received",
      header: t("col.received"),
      mobile: "meta",
      value: (d) => d.receivedAt,
      sortable: true,
      cell: (d) => <span className="tabular-nums text-muted">{dateTime(d.receivedAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "hide",
      cell: (d) =>
        d.can.canDelete && (
          // Above the row link that covers the row (see rowHref in data-table.tsx).
          <span className="relative z-10 flex justify-end">
            <IconButton
              tone="danger"
              label={t("delete")}
              loading={remover.pending === d.id}
              onClick={() => void remove(d)}
            >
              <IconTrash className="size-4" />
            </IconButton>
          </span>
        ),
    },
  ];

  return (
    <PageShell
      title={t("title")}
      // On a phone the panel shows only a picked document, so the dropzone's upload is here instead.
      aside={triage && <PhoneUpload onFile={(f) => void upload.send(f)} busy={upload.busy} />}
    >
      <ReceiptPanelSource
        onClose={() => setSelectedId(null)}
        documents={
          selected
            ? [
                {
                  src: `/api/supplier-invoice-documents/${selected.id}`,
                  mimeType: selected.mimeType,
                  filename: selected.filename,
                },
              ]
            : []
        }
        onFile={triage ? (f) => void upload.send(f) : undefined}
        uploading={upload.busy}
        multiple
        uploadCopy={{
          lead: t("dropLead"),
          leadShort: t("pickLead"),
          fileTypes: health?.address ? t("mailIn", { address: health.address }) : undefined,
          action: t("pick"),
          addLabel: t("addSeparate"),
        }}
      />
      {selected && (
        <ReceiptPanelFooter>
          <DocumentBar
            key={selected.id}
            document={selected}
            view={selected.mailed ? mode : null}
            onView={(next) => setView({ id: selected.id, mode: next })}
            resultUnits={resultUnits}
            onDone={() => advance(selected.id)}
          />
        </ReceiptPanelFooter>
      )}
      {selected && mode === "mail" && (
        <ReceiptPanelCover>
          <MailView key={selected.id} document={selected} />
        </ReceiptPanelCover>
      )}

      {health?.enabled && <MailboxWarning health={health} canConnect={canConnectMailbox} />}

      <Card>
        <ClientDataTable
          columns={columns}
          rows={rows}
          controls={controls}
          searchPlaceholder={t("searchPlaceholder")}
          rowKey={(d) => d.id}
          // A link to this page so the row is a link to tap and tab to. The click picks the document instead.
          rowHref={() => HOME}
          onRowClick={(d, e) => {
            e.preventDefault();
            setSelectedId(d.id === selectedId ? null : d.id);
          }}
          rowScroll={false}
          rowClassName={(d) =>
            d.id === selectedId
              ? "bg-accent-soft hover:bg-accent-soft [&>td:first-child]:shadow-[inset_2px_0_0_var(--color-accent)]"
              : undefined
          }
          empty={documents.length === 0 ? t("emptyTitle") : t("noMatch")}
        />
      </Card>

      {health?.enabled && <RejectedMail rejected={health.rejected} />}
    </PageShell>
  );
}

function useUpload(selectedId: string | null, select: (id: string) => void) {
  const t = useTranslations("invoices.inkorg");
  const notify = useNotify();
  const router = useProgressRouter();
  const m = useMutation();
  const [count, setCount] = useState(0);
  // Read when the upload lands, so a second file in the drop does not open over the first.
  const open = useRef(selectedId);
  useEffect(() => {
    open.current = selectedId;
  }, [selectedId]);
  async function send(file: File) {
    setCount((c) => c + 1);
    const form = new FormData();
    form.append("file", file);
    const created = await m.mutate<{ id: string }>("/api/supplier-invoice-documents", {
      body: form,
      key: file.name,
      refresh: false,
    });
    setCount((c) => c - 1);
    if (!created) return;
    notify.success(t("uploaded", { name: file.name }));
    if (open.current === null) {
      open.current = created.id;
      select(created.id);
    }
    router.refresh();
  }
  return { send, busy: count > 0 };
}

type PanelView = "pdf" | "mail";

function DocumentBar({
  document: d,
  view,
  onView,
  resultUnits,
  onDone,
}: {
  document: InboxDocument;
  /** Null for an uploaded document, which has no mail to show. */
  view: PanelView | null;
  onView: (view: PanelView) => void;
  resultUnits: { id: string; name: string }[];
  onDone: () => void;
}) {
  const t = useTranslations("invoices.inkorg");
  const assigner = useMutation();
  const [unit, setUnit] = useState("");
  const [dueDate, setDueDate] = useState("");
  // A date half typed is not one to send. Empty is: the unit reads it at the fördelning.
  const dueReady = dueDate === "" || isCompleteDate(dueDate);

  async function assign() {
    const name = resultUnits.find((u) => u.id === unit)?.name ?? "";
    const made = await assigner.mutate<{ id: string }>(
      `/api/supplier-invoice-documents/${d.id}/assign`,
      {
        body: { resultUnitId: unit, dueDate: dueDate || null },
        success: t("assigned", { unit: name }),
      },
    );
    if (made) onDone();
  }

  return (
    <div className="space-y-2 px-4 py-3">
      {view && (
        <ViewToggle
          labels
          aria-label={t("viewLabel")}
          value={view}
          onChange={onView}
          options={[
            { value: "pdf", label: t("viewPdf"), icon: IconInvoice },
            { value: "mail", label: t("viewMail"), icon: IconMail },
          ]}
        />
      )}
      {d.returned && (
        <ClampedText className="text-xs text-danger">
          {t("returned", { unit: d.returned.from ?? "-", reason: d.returned.reason })}
        </ClampedText>
      )}
      {d.note && (
        <ClampedText className="text-xs text-muted">
          <span className="font-medium text-foreground">{d.fromName ?? d.fromAddress}:</span>{" "}
          {d.note}
        </ClampedText>
      )}
      {d.can.canAssign && (
        <div className="flex items-end gap-2">
          <label className="block basis-36 shrink-[2]">
            <span className={`${LABEL} mb-1 block truncate`}>{t("dueDate")}</span>
            <DateInput size="sm" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <div className="min-w-0 flex-1 basis-40">
            <span className={`${LABEL} mb-1 block truncate`}>{t("createUnit")}</span>
            <Combobox
              size="sm"
              options={resultUnits.map((u) => ({ value: u.id, label: u.name }))}
              value={unit}
              onChange={setUnit}
              placeholder={t("createUnitPlaceholder")}
              searchPlaceholder={t("searchUnit")}
              aria-label={t("createUnit")}
            />
          </div>
          <Button
            size="md"
            disabled={!unit || !dueReady || assigner.busy}
            loading={assigner.busy}
            onClick={() => void assign()}
            className="shrink-0 whitespace-nowrap"
          >
            {t("assign")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** On a phone, where the panel has no dropzone: pick files to add to the Inkorg. */
function PhoneUpload({ onFile, busy }: { onFile: (file: File) => void; busy: boolean }) {
  const t = useTranslations("invoices.inkorg");
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="md:hidden">
      <Button size="sm" loading={busy} onClick={() => input.current?.click()}>
        <IconUpload className="size-4" />
        {t("pick")}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          for (const file of Array.from(e.target.files ?? [])) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** The mail a document came in, read in the panel in place of the PDF. Plain text: nothing in it is rendered as HTML. */
function MailView({ document: d }: { document: InboxDocument }) {
  const t = useTranslations("invoices.inkorg");
  const { dateTime } = useFormat();
  const mail = useQuery<{ body: string | null }>(`/api/supplier-invoice-documents/${d.id}/mail`);
  const body = mail.data?.body ?? null;
  const from =
    d.fromName && d.fromAddress
      ? `${d.fromName} <${d.fromAddress}>`
      : (d.fromName ?? d.fromAddress);
  return (
    <article className="px-inset pb-6">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-b border-border pb-3 text-sm">
        <dt className="text-muted">{t("mail.from")}</dt>
        <dd className="min-w-0 break-words">{from ?? "-"}</dd>
        <dt className="text-muted">{t("mail.subject")}</dt>
        <dd className="min-w-0 break-words font-medium">{d.subject ?? "-"}</dd>
        <dt className="text-muted">{t("mail.received")}</dt>
        <dd className="tabular-nums">{dateTime(d.receivedAt)}</dd>
      </dl>
      {mail.loading && !mail.data ? (
        <div className="flex justify-center pt-6">
          <Spinner />
        </div>
      ) : mail.error ? (
        <p className="pt-3 text-xs text-danger">{mail.error}</p>
      ) : body ? (
        <p className="whitespace-pre-wrap break-words pt-3 text-sm">{body}</p>
      ) : (
        <div className="space-y-2 pt-3 text-sm">
          {d.note && <p className="whitespace-pre-wrap break-words">{d.note}</p>}
          <p className="text-xs text-muted">{t("mail.notKept")}</p>
        </div>
      )}
    </article>
  );
}

/** Shown to triagers when the mailbox is not being read, with the way to fix it for those who can. */
function MailboxWarning({ health, canConnect }: { health: InboxHealth; canConnect: boolean }) {
  const t = useTranslations("invoices.mailbox");
  if (health.connected && !health.lastError) return null;
  return (
    <Notice tone={health.connected ? "warning" : "danger"}>
      <p>
        {health.connected
          ? t("failing", { error: health.lastError ?? "" })
          : t("notConnected", { address: health.address ?? "" })}
      </p>
      {canConnect ? (
        <Link href="/admin/email" className="font-medium link">
          {t("fixInSettings")}
        </Link>
      ) : (
        <p className="text-muted">{t("askAdmin")}</p>
      )}
    </Notice>
  );
}

/** Mail the inkorg refused in the last 30 days, often invoices sent from private addresses. */
function RejectedMail({ rejected }: { rejected: InboxHealth["rejected"] }) {
  const t = useTranslations("invoices.mailbox");
  const { dateTime } = useFormat();
  return (
    <Card>
      <div className="space-y-2 px-inset py-3 text-sm">
        <h2 className={LABEL}>{t("title")}</h2>
        {rejected.length === 0 ? (
          <p className="text-xs text-muted">{t("noneRejected")}</p>
        ) : (
          <>
            <p className="text-xs text-muted">{t("rejectedLead")}</p>
            <ul className="divide-y divide-divider">
              {rejected.map((r) => (
                <li key={r.id} className="py-1.5 text-xs">
                  <span className="block truncate">
                    {r.fromAddress || t("unknownSender")}
                    {r.subject && <span className="text-muted"> - {r.subject}</span>}
                  </span>
                  <span className="text-muted">
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
