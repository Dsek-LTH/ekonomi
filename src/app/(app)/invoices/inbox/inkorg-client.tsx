"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tag } from "@/components/ui/status-pill";
import { Combobox } from "@/components/ui/combobox";
import { IconButton } from "@/components/ui/icon-button";
import { IconTrash } from "@/components/ui/icons";
import {
  ClientDataTable,
  visibleRows,
  type ClientTabFilter,
} from "@/components/ui/client-data-table";
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
import { LABEL } from "@/components/record-card";
import { DueLabel } from "../invoice-bits";
import type { InboxDocument } from "@/lib/data/invoice-inbox";
import type { InboxHealth } from "@/lib/data/supplier-invoices";

const HOME = "/invoices/inbox";

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
  canConnectMailbox,
  ownsUnits,
}: {
  documents: InboxDocument[];
  selected: InboxDocument | null;
  resultUnits: { id: string; name: string }[];
  health: InboxHealth | null;
  triage: boolean;
  canConnectMailbox: boolean;
  ownsUnits: boolean;
}) {
  const t = useTranslations("invoices.inkorg");
  const router = useProgressRouter();
  const reveal = useRevealReceiptPanel();
  const upload = useUpload(selected?.id ?? null);
  const remover = useMutation();
  const confirm = useConfirm();
  const { dateTime } = useFormat();
  useMailboxConnectResult();
  const tabValues: InkorgTab[] = [
    ...(triage ? (["sort"] as const) : []),
    ...(ownsUnits ? (["allocate"] as const) : []),
    ...(triage || !ownsUnits ? (["units"] as const) : []),
  ];
  const controls = useTableControls({ tab: tabValues[0], sortKey: "received", sortDir: "asc" });
  const tabs: ClientTabFilter<InboxDocument> | undefined = useMemo(
    () =>
      tabValues.length > 1
        ? tabValues.map((value) => ({
            value,
            label: t(`tab.${value}`),
            predicate: TAB_HOLDS[value],
          }))
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, triage, ownsUnits],
  );
  const rows = tabs ? documents : documents.filter(TAB_HOLDS[tabValues[0]]);

  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (selectedId) reveal();
  }, [selectedId, reveal]);

  // Next on the open tab once this one is dealt with; none for one opened from outside what the table shows.
  const advance = (id: string) => {
    const shown = visibleRows({ columns, rows, controls, tabs });
    const i = shown.findIndex((d) => d.id === id);
    const next = i === -1 ? undefined : (shown[i + 1] ?? shown[i - 1]);
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
      refresh: d.id !== selectedId,
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
          searchPlaceholder={t("searchPlaceholder")}
          rowKey={(d) => d.id}
          rowHref={(d) => (d.id === selectedId ? HOME : `${HOME}?doc=${d.id}`)}
          rowScroll={false}
          rowClassName={(d) =>
            d.id === selectedId
              ? "bg-accent-soft hover:bg-accent-soft [&>td:first-child]:shadow-[inset_2px_0_0_var(--color-accent)]"
              : undefined
          }
          empty={
            documents.length === 0 ? (triage ? t("emptyTitle") : t("unitEmptyTitle")) : t("noMatch")
          }
        />
      </Card>

      {health?.enabled && <MailboxCard health={health} canConnect={canConnectMailbox} />}
    </PageShell>
  );
}

function useUpload(selectedId: string | null) {
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
      router.push(`${HOME}?doc=${created.id}`, { scroll: false });
    } else router.refresh();
  }
  return { send, busy: count > 0 };
}

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
        <p
          className="line-clamp-2 whitespace-pre-line text-xs text-danger"
          title={d.returned.reason}
        >
          {t("returned", { unit: d.returned.from ?? "-", reason: d.returned.reason })}
        </p>
      )}
      {d.note && (
        <p className="line-clamp-2 whitespace-pre-line text-xs text-muted" title={d.note}>
          <span className="font-medium text-foreground">{d.fromName ?? d.fromAddress}:</span>{" "}
          {d.note}
        </p>
      )}
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
                  options={resultUnits.map((u) => ({
                    value: u.id,
                    label: u.name,
                  }))}
                  value={unit}
                  onChange={setUnit}
                  placeholder={t("createUnitPlaceholder")}
                  searchPlaceholder={t("searchUnit")}
                  aria-label={t("createUnit")}
                />
              </div>
              <Button
                size="md"
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
                  size="md"
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
                <ButtonLink
                  size="md"
                  href={`/invoices/inbox/${d.id}`}
                  className="whitespace-nowrap"
                >
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

const CONNECT_REASONS = [
  "denied",
  "invalidState",
  "forbidden",
  "unconfigured",
  "wrongMailbox",
  "watchFailed",
];

/** The banner after Google sends the person back from connecting the mailbox (api/gmail/callback). */
function useMailboxConnectResult() {
  const t = useTranslations("invoices.mailbox.result");
  const notify = useNotify();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const result = searchParams.get("gmail");
  const reason = searchParams.get("reason");
  // replaceState does not feed back into useSearchParams, so remember what was announced (as in
  // components/shell/fortnox-auth-result.tsx).
  const announced = useRef<string | null>(null);

  useEffect(() => {
    if (!result) return;
    const outcome = `${result}:${reason ?? ""}`;
    if (announced.current === outcome) return;
    announced.current = outcome;
    if (result === "connected") notify.success(t("connected"));
    else notify.error(t(reason && CONNECT_REASONS.includes(reason) ? reason : "failed"));
    window.history.replaceState(null, "", pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
}

/**
 * The inkorg mailbox: whether it is connected, last read, last error and recently refused mail (often from
 * private addresses). Settings users connect and disconnect it here.
 */
function MailboxCard({ health, canConnect }: { health: InboxHealth; canConnect: boolean }) {
  const t = useTranslations("invoices.mailbox");
  const { dateTime } = useFormat();
  const confirm = useConfirm();
  const disconnector = useMutation();
  const disconnect = async () => {
    const ok = await confirm({
      title: t("disconnect"),
      message: t("disconnectConfirm", { address: health.address ?? "" }),
      confirmLabel: t("disconnect"),
      tone: "danger",
    });
    if (!ok) return;
    await disconnector.mutate("/api/gmail/connection", {
      method: "DELETE",
      success: t("disconnected"),
    });
  };
  return (
    <Card>
      <div className="space-y-2 px-inset py-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={LABEL}>{t("title")}</h2>
          {health.connected && (
            <span className="text-xs text-muted">
              {health.lastSyncAt
                ? t("lastSync", { when: dateTime(health.lastSyncAt) })
                : t("neverSynced")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {health.connected ? (
            <p className="text-xs text-muted">
              {health.connectedBy && health.connectedAt
                ? t("connectedBy", {
                    address: health.address ?? "",
                    name: health.connectedBy,
                    when: dateTime(health.connectedAt),
                  })
                : t("connected", { address: health.address ?? "" })}
            </p>
          ) : (
            <p className="text-warning">{t("notConnected", { address: health.address ?? "" })}</p>
          )}
          {canConnect && (
            <div className="flex gap-2">
              {health.connected && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={disconnector.busy}
                  onClick={disconnect}
                >
                  {t("disconnect")}
                </Button>
              )}
              <ButtonLink
                href="/api/gmail/connect"
                size="sm"
                variant={health.connected ? "secondary" : "primary"}
              >
                {health.connected ? t("reconnect") : t("connect")}
              </ButtonLink>
            </div>
          )}
        </div>
        {health.lastError && (
          <p className="text-danger">{t("error", { error: health.lastError })}</p>
        )}
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
