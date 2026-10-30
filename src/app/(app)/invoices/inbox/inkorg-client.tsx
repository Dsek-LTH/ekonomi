"use client";

// The levfaktura Inkorg: a table of every document no invoice has yet that
// the reader may see. Each row is the file, who sent it in and when, and
// nothing read off it. What the PDF says is read when its unit fördelar it.
//
// Two readers, one page. Triage's question is whose it is, and the file
// answers that once opened: its tabs are what waits to be given to a unit and
// what is with the units. A resultatansvarig's question is whether it is
// theirs: they see what was given to their units, and fördelar it, which
// makes it an invoice, or say it is not theirs.
//
// Clicking a row opens its PDF in the document panel beside the page, with
// what to do with it in a bar along the panel's foot. Beside the document
// being read, and out of the table, which stays as it was so the next row is
// always where it was. Nothing is open when the page loads: the panel comes
// when somebody asks to look at something.
//
// Deleting is the table's, a row action: it is the answer for a document that
// is not worth opening at all (a reminder, a newsletter), and the bar is for
// the ones that are.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/status-pill";
import { Combobox } from "@/components/ui/combobox";
import { IconButton } from "@/components/ui/icon-button";
import { IconTrash, IconUpload } from "@/components/ui/icons";
import { ClientDataTable, type ClientTabFilter } from "@/components/ui/client-data-table";
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
import { DateInput } from "@/components/ui/field";
import { isCompleteDate } from "@/lib/domain/date";
import { DueLabel } from "../invoice-bits";
import type { InboxDocument } from "@/lib/data/invoice-inbox";
import type { InboxHealth } from "@/lib/data/supplier-invoices";

const LABEL = "text-xs font-medium text-muted";
const HOME = "/invoices/inbox";

/** The tabs, each a question somebody has to answer about the documents in
 *  it: whose it is (triage), whether it is ours (the unit), and which are
 *  waiting on a unit (triage, keeping an eye on them). */
type InkorgTab = "sort" | "allocate" | "units";

const TAB_HOLDS: Record<InkorgTab, (d: InboxDocument) => boolean> = {
  sort: (d) => d.resultUnitId === null,
  allocate: (d) => d.can.canDecline,
  units: (d) => d.resultUnitId !== null,
};

export function InkorgClient({
  documents,
  selected,
  resultUnits,
  health,
  triage,
  ownsUnits,
}: {
  documents: InboxDocument[];
  /** The one opened from the table, or null with none open. */
  selected: InboxDocument | null;
  /** For triage's picker. Empty for anyone else. */
  resultUnits: { id: string; name: string }[];
  /** The mailbox, for triage. Null for anyone else. */
  health: InboxHealth | null;
  /** Whether the reader gives documents to units. */
  triage: boolean;
  /** Whether the reader answers for a unit, and so has documents to fördela. */
  ownsUnits: boolean;
}) {
  const t = useTranslations("invoices.inkorg");
  const router = useProgressRouter();
  const reveal = useRevealReceiptPanel();
  const upload = useUpload();
  const remover = useMutation();
  const confirm = useConfirm();
  const { dateTime } = useFormat();
  // Whoever gives documents out starts on what waits for that; a unit on
  // what waits for it. An admin who is neither sees what is with the units.
  const tabValues: InkorgTab[] = [
    ...(triage ? (["sort"] as const) : []),
    ...(ownsUnits ? (["allocate"] as const) : []),
    ...(triage || !ownsUnits ? (["units"] as const) : []),
  ];
  const controls = useTableControls({ tab: tabValues[0], sortKey: "received", sortDir: "asc" });
  const tabs: ClientTabFilter<InboxDocument> | undefined = useMemo(
    () =>
      tabValues.length > 1
        ? tabValues.map((value) => ({ value, label: t(`tab.${value}`), predicate: TAB_HOLDS[value] }))
        : undefined,
    // The values follow from the two flags.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, triage, ownsUnits],
  );
  // With one tab there is no tab bar, and the rows are that tab's.
  const rows = tabs ? documents : documents.filter(TAB_HOLDS[tabValues[0]]);

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
    const i = rows.findIndex((d) => d.id === id);
    const next = rows[i + 1] ?? rows[i - 1];
    router.push(next ? `${HOME}?doc=${next.id}` : HOME, { scroll: false });
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
      // The open one gone, the next opens; any other, the table refreshes.
      refresh: d.id !== selectedId,
    });
    if (res && d.id === selectedId) advance(d.id);
  }

  // One that came back from an invoice is marked, so it is not taken for
  // new. Why it came back is in the panel once it is opened.
  const columns: Column<InboxDocument>[] = [
    {
      key: "document",
      header: t("col.document"),
      mobile: "title",
      // The mail's subject and the forwarder's note are searched too, though
      // not shown: the panel shows them once the row is opened.
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
          {d.fromName ?? d.fromAddress ?? <span className="text-muted">{t("uploadedByUnknown")}</span>}
        </span>
      ),
    },
    // Whose Inkorg it is in, for whoever sees more than their own.
    ...(triage || !ownsUnits
      ? [
          {
            key: "unit",
            header: t("col.unit"),
            mobile: "meta" as const,
            value: (d: InboxDocument) => d.resultUnitName ?? "",
            sortable: true,
            searchable: true,
            cell: (d: InboxDocument) => d.resultUnitName ?? <span className="text-muted">-</span>,
          },
        ]
      : []),
    // When it is due, once triage has said, so the unit can tell what is
    // urgent. Undated after every dated one.
    {
      key: "dueDate",
      header: t("col.dueDate"),
      mobile: "meta",
      value: (d) => d.dueDate || "9999",
      sortable: true,
      cell: (d) => <DueLabel dueDate={d.dueDate || null} />,
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
          <DocumentBar
            // Fresh per document, so a unit picked for one is not still picked
            // for the next.
            key={selected.id}
            document={selected}
            resultUnits={resultUnits}
            onDone={() => advance(selected.id)}
          />
        </ReceiptPanelFooter>
      )}

      <Card>
        <ClientDataTable
          columns={columns}
          rows={rows}
          controls={controls}
          tabs={tabs}
          action={triage ? <UploadButton upload={upload} /> : undefined}
          searchPlaceholder={t("searchPlaceholder")}
          rowKey={(d) => d.id}
          // The open row's link closes it again; any other opens that one.
          rowHref={(d) => (d.id === selectedId ? HOME : `${HOME}?doc=${d.id}`)}
          // Opening one shows it beside the table, so the table stays put.
          rowScroll={false}
          // The fill and an ink bar at the row's start, so the open one is
          // not told from a hovered one by a step of grey alone.
          rowClassName={(d) =>
            d.id === selectedId
              ? "bg-accent-soft hover:bg-accent-soft [&>td:first-child]:shadow-[inset_2px_0_0_var(--color-accent)]"
              : undefined
          }
          empty={documents.length === 0 ? (triage ? t("emptyTitle") : t("unitEmptyTitle")) : t("noMatch")}
        />
      </Card>

      {health?.enabled && <MailboxCard health={health} />}
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

/**
 * What can be done with the open document, by whoever is reading it. Triage
 * gives it to a unit, or to another one. The unit fördelar it, on a page of its
 * own beside the PDF, or says it is not theirs. Triage may fördela on the
 * unit's behalf too, once it has one.
 */
function DocumentBar({
  document: d,
  resultUnits,
  onDone,
}: {
  document: InboxDocument;
  resultUnits: { id: string; name: string }[];
  onDone: () => void;
}) {
  const t = useTranslations("invoices.inkorg");
  const tAction = useTranslations("invoices.action");
  const confirm = useConfirm();
  const assigner = useMutation();
  const decliner = useMutation();
  const [unit, setUnit] = useState(d.resultUnitId ?? "");
  const [dueDate, setDueDate] = useState(d.dueDate);
  // A date half typed is not one to send. Empty is: it clears it.
  const dueReady = dueDate === "" || isCompleteDate(dueDate);
  // Sent again to the unit it is with, only the due date changes.
  const changed = unit !== d.resultUnitId || dueDate !== d.dueDate;

  async function assign() {
    const name = resultUnits.find((u) => u.id === unit)?.name ?? "";
    const ok = await assigner.mutate(`/api/supplier-invoice-documents/${d.id}/assign`, {
      body: { resultUnitId: unit, dueDate: dueDate || null },
      success: unit === d.resultUnitId ? t("dueSaved") : t("assigned", { unit: name }),
      refresh: unit === d.resultUnitId,
    });
    if (ok && unit !== d.resultUnitId) onDone();
  }

  async function decline() {
    const ok = await confirm({
      title: t("decline"),
      message: t("declineConfirm"),
      confirmLabel: t("decline"),
      comment: { label: tAction("returnLabel"), required: true },
    });
    if (!ok) return;
    const res = await decliner.mutate(`/api/supplier-invoice-documents/${d.id}/decline`, {
      body: { reason: ok.comment },
      success: t("declined"),
      refresh: false,
    });
    if (res) onDone();
  }

  const busy = assigner.busy || decliner.busy;
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
      {/* One row, whatever the panel's width: the buttons keep their size and
          the fields give way. The date only down to a whole date, which is
          as small as DateInput goes, and the unit's name the rest. */}
      {(d.can.canAssign || d.can.canAllocate || d.can.canDecline) && (
        <div className="flex items-end gap-2">
          {d.can.canAssign && (
            <>
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
                size="sm"
                variant={d.can.canAllocate ? "secondary" : "primary"}
                disabled={!unit || !changed || !dueReady || busy}
                loading={assigner.busy}
                onClick={() => void assign()}
                className="shrink-0 whitespace-nowrap"
              >
                {!d.resultUnitId ? t("assign") : unit === d.resultUnitId ? t("saveDue") : t("move")}
              </Button>
            </>
          )}
          {(d.can.canAllocate || d.can.canDecline) && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {d.can.canDecline && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  loading={decliner.busy}
                  onClick={() => void decline()}
                  className="whitespace-nowrap"
                >
                  {t("decline")}
                </Button>
              )}
              {d.can.canAllocate && (
                <ButtonLink size="sm" href={`/invoices/inbox/${d.id}`} className="whitespace-nowrap">
                  {t("allocate")}
                </ButtonLink>
              )}
            </div>
          )}
        </div>
      )}
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
