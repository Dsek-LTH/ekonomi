"use client";

// The levfaktura Inkorg: a table of every document no invoice has yet.
//
// Clicking a row opens its PDF in the document panel beside the page, with
// the one thing to do with it in a bar along the panel's foot: which unit it
// goes to, and Skapa faktura. Beside the document being read, and out of the table, which
// stays as it was so the next row is always where it was. Nothing is open when
// the page loads: the panel comes when somebody asks to look at something.
//
// Deleting is the table's, a row action: it is the answer for a document that
// is not worth opening at all (a reminder, a newsletter), and the bar is for
// the ones that are.
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { IconTrash, IconUpload } from "@/components/ui/icons";
import { ClientDataTable } from "@/components/ui/client-data-table";
import type { Column } from "@/components/ui/data-table";
import {
  ReceiptPanelFooter,
  ReceiptPanelSource,
  useRevealReceiptPanel,
} from "@/components/receipt/receipt-panel";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { useProgressRouter } from "@/components/shell/route-progress";
import { useTableControls } from "@/lib/data/use-list-query";
import { useFormat } from "@/lib/ui/use-format";
import type { InboxDocument } from "@/lib/data/invoice-inbox";
import type { InboxHealth } from "@/lib/data/supplier-invoices";

const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-muted";
const HOME = "/invoices/inbox";

export function InkorgClient({
  documents,
  selected,
  resultUnits,
  health,
}: {
  documents: InboxDocument[];
  /** The one opened from the table, or null with none open. */
  selected: InboxDocument | null;
  resultUnits: { id: string; name: string }[];
  health: InboxHealth;
}) {
  const t = useTranslations("invoices.inkorg");
  const router = useProgressRouter();
  const reveal = useRevealReceiptPanel();
  const upload = useUpload();
  const remover = useMutation();
  const confirm = useConfirm();
  const { dateTime } = useFormat();
  const controls = useTableControls({ sortKey: "received", sortDir: "asc" });

  // Opening a row is asking to see it, so the panel unfolds even if it was
  // folded on some other page.
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (selectedId) reveal();
  }, [selectedId, reveal]);

  // The next one once this one is dealt with: the one after it, or before it
  // when it was the last, so working down the table never needs a click to
  // open the next.
  const advance = (id: string) => {
    const i = documents.findIndex((d) => d.id === id);
    const next = documents[i + 1] ?? documents[i - 1];
    router.push(next ? `${HOME}?doc=${next.id}` : HOME, { scroll: false });
  };

  async function remove(d: InboxDocument) {
    const ok = await confirm({
      title: t("delete"),
      message: t("deleteConfirm", { name: d.subject || d.filename }),
      confirmLabel: t("delete"),
      tone: "danger",
    });
    if (!ok) return;
    const res = await remover.mutate(`/api/supplier-invoice-documents/${d.id}`, {
      key: d.id,
      method: "DELETE",
      success: t("deleted"),
      // The open one gone, the next opens; any other, the table refreshes.
      refresh: d.id !== selectedId,
    });
    if (res && d.id === selectedId) advance(d.id);
  }

  // A document sent back from an invoice says from where and why, ahead of
  // anything the original mail said: it is the newer news.
  const returnedText = (r: NonNullable<InboxDocument["returned"]>) =>
    t("returned", { unit: r.from ?? "-", reason: r.reason });

  const columns: Column<InboxDocument>[] = [
    {
      key: "document",
      header: t("col.document"),
      mobile: "title",
      value: (d) => d.subject || d.filename,
      sortable: true,
      searchable: true,
      cell: (d) => <span className="block truncate font-medium">{d.subject || d.filename}</span>,
    },
    {
      key: "from",
      header: t("col.from"),
      mobile: "meta",
      value: (d) => d.fromName ?? d.fromAddress ?? "",
      sortable: true,
      searchable: true,
      cell: (d) => d.fromName ?? d.fromAddress ?? <span className="text-muted">{t("uploadedByUnknown")}</span>,
    },
    {
      key: "note",
      header: t("col.note"),
      mobile: "hide",
      value: (d) => [d.returned && returnedText(d.returned), d.note].filter(Boolean).join(" "),
      searchable: true,
      className: "max-w-80",
      cell: (d) =>
        d.returned ? (
          <span className="block truncate text-danger">{returnedText(d.returned)}</span>
        ) : d.note ? (
          <span className="block truncate text-muted">{d.note}</span>
        ) : null,
    },
    {
      key: "received",
      header: t("col.received"),
      mobile: "trailing",
      value: (d) => d.receivedAt,
      sortable: true,
      cell: (d) => <span className="tabular-nums text-muted">{dateTime(d.receivedAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "hide",
      cell: (d) => (
        // Above the row's link, which covers the row so a click anywhere
        // opens it. See the note on rowHref in components/ui/data-table.tsx.
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
    <PageShell title={t("title")}>
      <ReceiptPanelSource
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
      />
      {selected && (
        <ReceiptPanelFooter>
          <CreateBar
            // Fresh per document, so a unit picked for one is not still picked
            // for the next.
            key={selected.id}
            document={selected}
            resultUnits={resultUnits}
            onDone={() => advance(selected.id)}
          />
        </ReceiptPanelFooter>
      )}

      {documents.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={<UploadButton upload={upload} />}
        />
      ) : (
        <Card>
          <ClientDataTable
            columns={columns}
            rows={documents}
            controls={controls}
            action={<UploadButton upload={upload} />}
            searchPlaceholder={t("searchPlaceholder")}
            rowKey={(d) => d.id}
            // The open row's link closes it again; any other opens that one.
            rowHref={(d) => (d.id === selectedId ? HOME : `${HOME}?doc=${d.id}`)}
            // Opening one shows it beside the table, so the table stays put.
            rowScroll={false}
            rowClassName={(d) => (d.id === selectedId ? "bg-accent-soft hover:bg-accent-soft" : undefined)}
            empty={t("noMatch")}
          />
        </Card>
      )}

      {health.enabled && <MailboxCard health={health} />}
    </PageShell>
  );
}

// ── Putting documents in ──────────────────────────────────────────

function useUpload() {
  const t = useTranslations("invoices.inkorg");
  const notify = useNotify();
  const m = useMutation();
  const [count, setCount] = useState(0);
  async function send(file: File) {
    setCount((c) => c + 1);
    const form = new FormData();
    form.append("file", file);
    const ok = await m.mutate("/api/supplier-invoice-documents", { body: form, key: file.name });
    setCount((c) => c - 1);
    if (ok) notify.success(t("uploaded", { name: file.name }));
  }
  return { send, busy: count > 0 };
}

function UploadButton({ upload }: { upload: ReturnType<typeof useUpload> }) {
  const t = useTranslations("invoices.inkorg");
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={picker}
        type="file"
        multiple
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          for (const f of files) void upload.send(f);
        }}
      />
      <Button size="sm" variant="accentOutline" loading={upload.busy} onClick={() => picker.current?.click()}>
        <IconUpload className="size-4" />
        {t("upload")}
      </Button>
    </>
  );
}

// ── The bar at the panel's foot ───────────────────────────────────

/** The open document made into an invoice for a unit, one step, so one look
 *  at the PDF does both. The unit is required: see the create route. */
function CreateBar({
  document: d,
  resultUnits,
  onDone,
}: {
  document: InboxDocument;
  resultUnits: { id: string; name: string }[];
  onDone: () => void;
}) {
  const t = useTranslations("invoices.inkorg");
  const m = useMutation();
  const [unit, setUnit] = useState("");

  async function create() {
    const created = await m.mutate<{ id: string }>("/api/supplier-invoices", {
      body: { documentId: d.id, resultUnitId: unit },
      success: t("created"),
      refresh: false,
    });
    if (created) onDone();
  }

  return (
    <div className="space-y-2 px-4 py-3">
      {d.returned && (
        <p className="line-clamp-2 whitespace-pre-line text-xs text-danger" title={d.returned.reason}>
          {t("returned", { unit: d.returned.from ?? "-", reason: d.returned.reason })}
        </p>
      )}
      {d.note && (
        <p className="line-clamp-2 whitespace-pre-line text-xs text-muted" title={d.note}>
          <span className="font-medium text-foreground">{d.fromName ?? d.fromAddress}:</span> {d.note}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1">
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
        <Button size="sm" disabled={!unit} loading={m.busy} onClick={() => void create()}>
          {t("create")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The inkorg mailbox: when it was last read, the error if the last read
 * failed, and the mail it refused lately. A forward that "never arrived" is
 * usually here, refused for coming from a private address.
 */
function MailboxCard({ health }: { health: InboxHealth }) {
  const t = useTranslations("invoices.mailbox");
  const { dateTime } = useFormat();
  return (
    <Card>
      <div className="space-y-2 px-inset py-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={LABEL}>{t("title")}</h2>
          <span className="text-xs text-muted">
            {health.lastSyncAt ? t("lastSync", { when: dateTime(health.lastSyncAt) }) : t("neverSynced")}
          </span>
        </div>
        {health.lastError && <p className="text-danger">{t("error", { error: health.lastError })}</p>}
        {health.rejected.length === 0 ? (
          <p className="text-xs text-muted">{t("noneRejected")}</p>
        ) : (
          <>
            <p className="text-xs text-muted">{t("rejectedLead")}</p>
            <ul className="divide-y divide-border">
              {health.rejected.map((r) => (
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
