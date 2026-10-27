"use client";

// One levfaktura, as whoever has it in front of them needs it: the one thing
// the invoice is waiting for from them, first and on its own, and everything
// else under it.
//
// Used in both shapes of the page: the treasurer's inbox, where it is the
// right-hand pane beside the list, and the resultatansvarig's one-at-a-time
// view, where it is the whole page. The PDF is not in here. It goes in the
// app's document panel beside the page (ReceiptPanelSource), the way an
// utlägg's receipt does.
//
// What each stage asks:
//
//   inkorg            triage: whose is it (or delete it)
//   waiting attest    the unit: which cost centre, and Attestera
//   split, partly     another unit: Attestera their share
//   attested          the treasurer: complete the details for Fortnox
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput, Field, FieldGroup, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { IconCheck, IconX } from "@/components/ui/icons";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { commaForm, parseOre, parseSEK } from "@/lib/domain/money";
import { attestBlocker, type InvoiceCapabilities } from "@/lib/domain/supplier-invoice";
import { formatSEK } from "@/lib/ui/format";
import { useFormat } from "@/lib/ui/use-format";
import { cn, uid } from "@/lib/ui/utils";
import type {
  PatchSupplierInvoice,
  TransitionSupplierInvoice,
} from "@/lib/api/schemas/supplier-invoice";
import type { AccountRecord, CostCenter, SupplierInvoiceStatus } from "@/lib/domain/types";
import type { AttestReach, SupplierInvoiceView } from "@/lib/data/supplier-invoices";
import { DueLabel, InvoiceStatusPill, useInvoiceTitle } from "./invoice-bits";

/** The small capitals every label on the card is set in, as on the utlägg page. */
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-muted";

/** An amount in kronor as the amount field writes one. */
const asInput = (sek: number | null) =>
  sek == null ? "" : commaForm((Math.round(sek * 100) / 100).toFixed(2));

export interface WorkspaceProps {
  invoice: SupplierInvoiceView;
  /** Decided on the server. See invoiceCapabilities. */
  can: InvoiceCapabilities;
  /** Who the viewer may attest for, so the button can say whether pressing it
   *  signs the invoice or only sends it to somebody who can. */
  reach: AttestReach;
  costCenters: CostCenter[];
  accounts: AccountRecord[];
  resultUnits: { id: string; name: string }[];
  /**
   * Called after an action that finishes the viewer's part, with the status it
   * left the invoice in. The inbox moves on to the next invoice; without it the
   * page simply refreshes in place.
   */
  onDone?: (status: SupplierInvoiceStatus | "DELETED") => void;
  /** Above the title: the one-at-a-time view's "1 av 3". */
  header?: React.ReactNode;
}

export function InvoiceWorkspace(props: WorkspaceProps) {
  const { invoice, can, onDone, header } = props;
  const t = useTranslations("invoices.workspace");
  const tDetail = useTranslations("invoices.detail");
  const title = useInvoiceTitle();
  const docs = useMutation();
  const confirm = useConfirm();
  const url = `/api/supplier-invoices/${invoice.id}`;

  async function uploadDocument(file: File) {
    const form = new FormData();
    form.append("file", file);
    await docs.mutate(`${url}/documents`, { body: form, key: "upload" });
  }

  async function removeDocument(id: string, filename: string) {
    const ok = await confirm({
      title: tDetail("removeDocument"),
      message: tDetail("removeDocumentConfirm", { filename }),
      confirmLabel: tDetail("removeDocument"),
      tone: "danger",
    });
    if (ok) await docs.mutate(`/api/supplier-invoice-documents/${id}`, { method: "DELETE", key: id });
  }

  return (
    <div className="space-y-4">
      <ReceiptPanelSource
        documents={invoice.documents.map((d) => ({
          src: `/api/supplier-invoice-documents/${d.id}`,
          mimeType: d.mimeType,
          filename: d.filename,
          label: invoice.documents.length > 1 ? d.filename : undefined,
        }))}
        onFile={can.canEditDocuments ? (f) => void uploadDocument(f) : undefined}
        uploading={docs.pending === "upload"}
        multiple={can.canEditDocuments}
        uploadCopy={{
          lead: tDetail("upload.lead"),
          leadShort: tDetail("upload.leadShort"),
          action: tDetail("upload.action"),
          addLabel: tDetail("upload.add"),
        }}
        emptyTitle={tDetail("noDocumentTitle")}
        emptyDescription={tDetail("noDocument")}
      />

      {header}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{title(invoice)}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <DueLabel dueDate={invoice.dueDate} />
            {invoice.resultUnitName && <span className="text-muted">{invoice.resultUnitName}</span>}
            {invoice.invoiceNumber && (
              <span className="text-muted">{tDetail("invoiceNo", { number: invoice.invoiceNumber })}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {invoice.amount != null && (
            <span className="text-lg font-semibold tabular-nums">{formatSEK(invoice.amount)}</span>
          )}
          <InvoiceStatusPill status={invoice.status} />
        </div>
      </div>

      {invoice.mail?.note && (
        <blockquote className="whitespace-pre-line border-l-2 border-border pl-3 text-sm text-muted">
          <span className="font-medium text-foreground">
            {invoice.mail.fromName ?? invoice.mail.fromAddress}:
          </span>{" "}
          {invoice.mail.note}
        </blockquote>
      )}

      <ReturnedNotice invoice={invoice} />

      <StagePanel {...props} />

      <Card>
        <DetailsSection invoice={invoice} editable={can.canEditDetails && invoice.status !== "APPROVED"} />
        <RowsSection invoice={invoice} />
        {invoice.documents.length > 0 && (
          <section className="border-t border-border px-inset py-4">
            <h3 className={cn(LABEL, "mb-2")}>{tDetail("documents")}</h3>
            <ul className="space-y-1 text-sm">
              {invoice.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3">
                  <a
                    href={`/api/supplier-invoice-documents/${d.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 truncate text-accent hover:underline"
                  >
                    {d.filename}
                  </a>
                  {can.canEditDocuments && (
                    <button
                      type="button"
                      aria-label={tDetail("removeDocument")}
                      disabled={docs.busy}
                      onClick={() => void removeDocument(d.id, d.filename)}
                      className="shrink-0 rounded-control p-1 text-muted hover:bg-hover hover:text-danger disabled:opacity-40"
                    >
                      <IconX className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <SecondaryActions invoice={invoice} can={can} resultUnits={props.resultUnits} onDone={onDone} />
        <Timeline invoice={invoice} />
      </Card>

      {!can.canEditDocuments && invoice.documents.length === 0 && (
        <p className="text-sm text-muted">{t("noDocumentReadOnly")}</p>
      )}
    </div>
  );
}

/** The comment it was sent back with, where the person it went back to looks
 *  first. */
function ReturnedNotice({ invoice }: { invoice: SupplierInvoiceView }) {
  const t = useTranslations("invoices.detail");
  if (invoice.status !== "CHANGES_REQUESTED") return null;
  const last = [...invoice.events].reverse().find((e) => e.type === "CHANGES_REQUESTED");
  if (!last?.comment) return null;
  return (
    <Notice tone="warning">
      <p className="font-medium">{t("returnedTitle", { name: last.actor ?? "-" })}</p>
      <p>{last.comment}</p>
    </Notice>
  );
}

// ── The one thing it is waiting for ───────────────────────────────

function useTransition(invoiceId: string, onDone?: WorkspaceProps["onDone"]) {
  const tAction = useTranslations("invoices.action");
  const m = useMutation();
  async function run(body: TransitionSupplierInvoice): Promise<boolean> {
    const res = await m.mutate<{ status: SupplierInvoiceStatus }>(
      `/api/supplier-invoices/${invoiceId}/transition`,
      { body, key: body.action, success: tAction(`done.${body.action}`), refresh: !onDone },
    );
    if (res && onDone) onDone(res.status);
    return res !== null;
  }
  return { ...m, run };
}

function StagePanel(props: WorkspaceProps) {
  const { invoice, can } = props;
  if (invoice.status === "INBOX" && can.canAssign) return <AssignPanel {...props} />;
  if (can.canKontera) return <KonteraPanel {...props} />;
  if (can.canAttest) return <SharePanel {...props} />;
  if (invoice.status === "APPROVED" && can.canEditDetails) return <ExportPanel {...props} />;
  return <WaitingPanel invoice={invoice} />;
}

/** The inkorg: whose is it. */
function AssignPanel({ invoice, can, resultUnits, onDone }: WorkspaceProps) {
  const t = useTranslations("invoices.workspace");
  const tAction = useTranslations("invoices.action");
  const tr = useTransition(invoice.id, onDone);
  const del = useMutation();
  const confirm = useConfirm();
  const [unit, setUnit] = useState(invoice.suggestedUnit?.id ?? "");

  async function remove() {
    const ok = await confirm({
      title: tAction("delete"),
      message: tAction("confirm.delete"),
      confirmLabel: tAction("delete"),
      tone: "danger",
    });
    if (!ok) return;
    const res = await del.mutate(`/api/supplier-invoices/${invoice.id}`, {
      method: "DELETE",
      success: tAction("done.delete"),
      refresh: !onDone,
    });
    if (res && onDone) onDone("DELETED");
  }

  return (
    <Card>
      <div className="space-y-3 px-inset py-4">
        <h3 className={LABEL}>{t("assignTitle")}</h3>
        {invoice.suggestedUnit && (
          <p className="text-sm text-muted">
            {t("suggestion", { sender: invoice.mail?.originalFrom ?? "", unit: invoice.suggestedUnit.name })}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <Combobox
              options={resultUnits.map((u) => ({ value: u.id, label: u.name }))}
              value={unit}
              onChange={setUnit}
              placeholder={t("pickUnit")}
              searchPlaceholder={t("searchUnit")}
              aria-label={t("assignTitle")}
            />
          </div>
          <Button
            disabled={!unit || tr.busy}
            loading={tr.pending === "assign"}
            onClick={() => void tr.run({ action: "assign", resultUnitId: unit })}
          >
            {t("assign")}
          </Button>
          {can.canDelete && (
            <Button variant="dangerOutline" loading={del.busy} onClick={() => void remove()}>
              {tAction("delete")}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted">{t("assignHint")}</p>
      </div>
    </Card>
  );
}

interface Row {
  id: string;
  costCenterCode: string;
  amount: string; // as typed, kronor
}

/** The unit's step: which cost centre, and Attestera. One step, because
 *  picking where the cost belongs and signing for it is one decision. */
function KonteraPanel({ invoice, can, reach, costCenters, onDone }: WorkspaceProps) {
  const t = useTranslations("invoices.workspace");
  const tAction = useTranslations("invoices.action");
  const tErr = useTranslations("errors");
  const tr = useTransition(invoice.id, onDone);
  const confirm = useConfirm();

  const initial: Row[] =
    invoice.allocations.length > 0
      ? invoice.allocations.map((a) => ({
          id: a.id,
          costCenterCode: a.costCenterCode,
          amount: asInput(a.amount),
        }))
      : [{ id: uid(), costCenterCode: invoice.suggestedCostCenter ?? "", amount: "" }];
  const [rows, setRows] = useState<Row[]>(initial);
  const [comment, setComment] = useState(invoice.allocations[0]?.comment ?? "");
  const split = rows.length > 1;

  const unitOf = useMemo(() => new Map(costCenters.map((c) => [c.code, c.resultUnit ?? null])), [costCenters]);
  const mayAttest = (code: string) => reach.all || reach.units.includes(unitOf.get(code) ?? "");
  const allMine = rows.every((r) => r.costCenterCode && mayAttest(r.costCenterCode));

  const options = useMemo(() => {
    // The unit's own cost centres first: that is nearly always the answer.
    const own = (c: CostCenter) => (c.resultUnit && c.resultUnit === invoice.resultUnitName ? 0 : 1);
    return [...costCenters]
      .sort((a, b) => own(a) - own(b) || a.code.localeCompare(b.code))
      .map((c) => ({ value: c.code, label: `${c.code} - ${c.name}`, short: c.code }));
  }, [costCenters, invoice.resultUnitName]);

  const payload = rows
    .filter((r) => r.costCenterCode)
    .map((r) => ({
      costCenterCode: r.costCenterCode,
      amount: split && r.amount.trim() ? parseOre(r.amount) : null,
      comment: comment.trim() || null,
    }));
  const blocker =
    payload.length !== rows.length
      ? "supplierInvoice.noAllocations"
      : attestBlocker({
          documentCount: invoice.documents.length,
          rows: payload.map((p) => ({ amount: p.amount ?? null })),
          invoiceAmount: invoice.amount == null ? null : Math.round(invoice.amount * 100),
        });

  const update = (id: string, patch: Partial<Row>) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function decline() {
    const ok = await confirm({
      title: tAction("decline"),
      message: tAction("confirm.decline"),
      confirmLabel: tAction("decline"),
      comment: { label: tAction("declineLabel"), required: true },
    });
    if (ok) await tr.run({ action: "decline", comment: ok.comment });
  }

  const sum = rows.reduce((s, r) => s + parseSEK(r.amount), 0);

  return (
    <Card>
      <div className="space-y-3 px-inset py-4">
        <h3 className={LABEL}>{t("konteraTitle")}</h3>

        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2">
              <div className="min-w-56 flex-1">
                <Combobox
                  options={options}
                  value={r.costCenterCode}
                  onChange={(v) => update(r.id, { costCenterCode: v })}
                  placeholder={t("pickCostCenter")}
                  searchPlaceholder={t("searchCostCenter")}
                  aria-label={t("costCenter")}
                />
              </div>
              {split && (
                <>
                  <AmountInput
                    className="w-36"
                    suffix="kr"
                    value={r.amount}
                    onChange={(v) => update(r.id, { amount: v })}
                    inputClassName="text-right tabular-nums"
                    aria-label={t("share")}
                  />
                  <button
                    type="button"
                    aria-label={t("removeRow")}
                    onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
                    className="rounded-control p-2 text-muted hover:bg-hover hover:text-danger"
                  >
                    <IconX className="size-4" />
                  </button>
                </>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() =>
                setRows([
                  ...rows,
                  // The share left over, when the total is known: the
                  // commonest split is "this much here and the rest there".
                  {
                    id: uid(),
                    costCenterCode: "",
                    amount:
                      invoice.amount != null && invoice.amount - sum > 0.005 ? asInput(invoice.amount - sum) : "",
                  },
                ])
              }
              className="text-sm font-medium text-accent hover:underline"
            >
              {split ? t("addRow") : t("split")}
            </button>
            {split && (
              <span className="text-xs tabular-nums text-muted">
                {invoice.amount != null
                  ? t("splitOfTotal", { sum: formatSEK(sum), total: formatSEK(invoice.amount) })
                  : t("splitSum", { sum: formatSEK(sum) })}
              </span>
            )}
          </div>
        </div>

        <Input
          value={comment}
          placeholder={t("commentPlaceholder")}
          onChange={(e) => setComment(e.target.value)}
          aria-label={t("comment")}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={Boolean(blocker) || tr.busy}
            loading={tr.pending === "attest"}
            onClick={() => void tr.run({ action: "attest", rows: payload })}
          >
            {allMine && <IconCheck className="size-4" />}
            {allMine ? tAction("attest") : tAction("sendForAttest")}
          </Button>
          {can.canDecline && (
            <Button variant="secondary" disabled={tr.busy} onClick={() => void decline()}>
              {tAction("decline")}
            </Button>
          )}
          {blocker && <span className="text-xs text-muted">{tErr(blocker)}</span>}
        </div>
        {!allMine && rows.every((r) => r.costCenterCode) && (
          <p className="text-xs text-muted">{t("othersSign")}</p>
        )}
      </div>
    </Card>
  );
}

/** Another unit's share of a split, waiting for this viewer. */
function SharePanel({ invoice, onDone }: WorkspaceProps) {
  const t = useTranslations("invoices.workspace");
  const tAction = useTranslations("invoices.action");
  const tr = useTransition(invoice.id, onDone);
  const confirm = useConfirm();
  const mine = invoice.allocations.filter((a) => a.canAttest && !a.approvedByName);

  async function sendBack() {
    const ok = await confirm({
      title: tAction("request_changes"),
      message: tAction("confirm.request_changes"),
      confirmLabel: tAction("request_changes"),
      comment: { label: tAction("commentLabel"), required: true },
    });
    if (ok) await tr.run({ action: "request_changes", comment: ok.comment });
  }

  return (
    <Card>
      <div className="space-y-3 px-inset py-4">
        <h3 className={LABEL}>{t("shareTitle")}</h3>
        <ul className="space-y-1 text-sm">
          {mine.map((a) => (
            <li key={a.id} className="flex justify-between gap-4">
              <span>
                {a.costCenterCode} - {a.costCenterName}
              </span>
              <span className="tabular-nums">{a.amount == null ? "" : formatSEK(a.amount)}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button loading={tr.pending === "attest"} onClick={() => void tr.run({ action: "attest" })}>
            <IconCheck className="size-4" />
            {tAction("attest")}
          </Button>
          <Button variant="secondary" disabled={tr.busy} onClick={() => void sendBack()}>
            {tAction("request_changes")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Nothing for this viewer to do: say who it is waiting on instead. */
function WaitingPanel({ invoice }: { invoice: SupplierInvoiceView }) {
  const t = useTranslations("invoices.workspace");
  const waitingOn = [
    ...new Set(invoice.allocations.filter((a) => !a.approvedByName).map((a) => a.resultUnit ?? a.costCenterCode)),
  ];
  const text =
    invoice.status === "INBOX"
      ? t("waiting.inbox")
      : invoice.status === "ASSIGNED" || invoice.status === "CHANGES_REQUESTED"
        ? t("waiting.unit", { unit: invoice.resultUnitName ?? "-" })
        : invoice.status === "PENDING_APPROVAL"
          ? t("waiting.share", { units: waitingOn.join(", ") })
          : invoice.status === "APPROVED"
            ? t("waiting.export")
            : t("waiting.exported");
  return (
    <div className="rounded-control bg-surface px-4 py-3 text-sm text-muted">{text}</div>
  );
}

// ── The treasurer's step ──────────────────────────────────────────

interface Facts {
  supplierName: string;
  supplierOrgNo: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amount: string;
  ocr: string;
  bankgiro: string;
  plusgiro: string;
  description: string;
}

const factsOf = (i: SupplierInvoiceView): Facts => ({
  supplierName: i.supplierName ?? "",
  supplierOrgNo: i.supplierOrgNo ?? "",
  invoiceNumber: i.invoiceNumber ?? "",
  invoiceDate: i.invoiceDate,
  dueDate: i.dueDate,
  amount: asInput(i.amount),
  ocr: i.ocr ?? "",
  bankgiro: i.bankgiro ?? "",
  plusgiro: i.plusgiro ?? "",
  description: i.description ?? "",
});

const patchOf = (f: Facts): PatchSupplierInvoice => ({
  supplierName: f.supplierName,
  supplierOrgNo: f.supplierOrgNo,
  invoiceNumber: f.invoiceNumber,
  invoiceDate: f.invoiceDate,
  dueDate: f.dueDate,
  amount: f.amount.trim() ? parseOre(f.amount) : null,
  ocr: f.ocr,
  bankgiro: f.bankgiro,
  plusgiro: f.plusgiro,
  description: f.description,
});

/** The fields the treasurer completes, as a grid. Shared by the export step
 *  and by the details section while it is still editable. A field read off
 *  the PDF says so, which is what the treasurer checks against it. */
function FactsForm({
  facts,
  set,
  prefilled,
}: {
  facts: Facts;
  set: (p: Partial<Facts>) => void;
  prefilled: readonly string[];
}) {
  const t = useTranslations("invoices.field");
  const tWs = useTranslations("invoices.workspace");
  const hint = (key: keyof Facts) => (prefilled.includes(key) ? tWs("fromPdf") : undefined);
  const text = (key: keyof Facts, opts: { wide?: boolean; numeric?: boolean } = {}) => (
    <div className={cn(opts.wide && "sm:col-span-2")}>
      <Field label={t(key)} hint={hint(key)}>
        <Input
          size="sm"
          value={facts[key]}
          inputMode={opts.numeric ? "numeric" : undefined}
          onChange={(e) => set({ [key]: e.target.value })}
        />
      </Field>
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {text("supplierName")}
      {text("supplierOrgNo")}
      <Field label={t("amount")} hint={hint("amount")}>
        <AmountInput size="sm" suffix="kr" value={facts.amount} onChange={(v) => set({ amount: v })} />
      </Field>
      {text("invoiceNumber")}
      <Field label={t("invoiceDate")} hint={hint("invoiceDate")}>
        <DateInput size="sm" value={facts.invoiceDate} onChange={(e) => set({ invoiceDate: e.target.value })} />
      </Field>
      <Field label={t("dueDate")} hint={hint("dueDate")}>
        <DateInput size="sm" value={facts.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
      </Field>
      {text("ocr", { numeric: true })}
      {text("bankgiro")}
      {text("plusgiro")}
      {text("description", { wide: true })}
    </div>
  );
}

/** Attested: the treasurer completes what Fortnox needs. The export itself is
 *  the next step; this is where the invoice is made ready for it. */
function ExportPanel({ invoice, accounts }: WorkspaceProps) {
  const t = useTranslations("invoices.workspace");
  const tDetail = useTranslations("invoices.detail");
  const save = useMutation();
  const initialFacts = useMemo(() => factsOf(invoice), [invoice]);
  const initialAccounts = useMemo(
    () => Object.fromEntries(invoice.allocations.map((a) => [a.id, a.account ?? ""])),
    [invoice],
  );
  const [facts, setFacts] = useState(initialFacts);
  const [accountOf, setAccountOf] = useState<Record<string, string>>(initialAccounts);
  const [seen, setSeen] = useState(invoice.updatedAt);
  if (seen !== invoice.updatedAt) {
    setSeen(invoice.updatedAt);
    setFacts(initialFacts);
    setAccountOf(initialAccounts);
  }

  const body: PatchSupplierInvoice = {
    ...patchOf(facts),
    accounts: invoice.allocations.map((a) => ({ allocationId: a.id, account: accountOf[a.id] || null })),
  };
  const initialBody: PatchSupplierInvoice = {
    ...patchOf(initialFacts),
    accounts: invoice.allocations.map((a) => ({ allocationId: a.id, account: initialAccounts[a.id] || null })),
  };
  const dirty = JSON.stringify(body) !== JSON.stringify(initialBody);

  const accountOptions = accounts.map((a) => ({ value: a.number, label: `${a.number} - ${a.name}`, short: a.number }));

  return (
    <Card>
      <div className="space-y-4 px-inset py-4">
        <h3 className={LABEL}>{t("exportTitle")}</h3>
        <FactsForm facts={facts} set={(p) => setFacts((f) => ({ ...f, ...p }))} prefilled={invoice.prefilled} />

        <div className="space-y-2">
          <p className={LABEL}>{t("accounts")}</p>
          {invoice.allocations.map((a) => (
            <div key={a.id} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <span className="truncate text-sm">
                {a.costCenterCode} - {a.costCenterName}
                {a.amount != null && <span className="text-muted"> - {formatSEK(a.amount)}</span>}
              </span>
              <Combobox
                size="sm"
                options={accountOptions}
                value={accountOf[a.id] ?? ""}
                onChange={(v) => setAccountOf((m) => ({ ...m, [a.id]: v }))}
                placeholder={t("pickAccount")}
                searchPlaceholder={t("searchAccount")}
                aria-label={t("accounts")}
              />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!dirty}
            loading={save.busy}
            onClick={() =>
              void save.mutate(`/api/supplier-invoices/${invoice.id}`, {
                method: "PATCH",
                body,
                success: tDetail("saved"),
              })
            }
          >
            {tDetail("save")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ── Everything else ───────────────────────────────────────────────

/** What the invoice says. Editable for the treasurer before it is attested;
 *  once attested, the export step above is where it is completed. */
function DetailsSection({ invoice, editable }: { invoice: SupplierInvoiceView; editable: boolean }) {
  const t = useTranslations("invoices.field");
  const tDetail = useTranslations("invoices.detail");
  const tWs = useTranslations("invoices.workspace");
  const { date } = useFormat();
  const save = useMutation();
  const [open, setOpen] = useState(false);
  const initial = useMemo(() => factsOf(invoice), [invoice]);
  const [facts, setFacts] = useState(initial);
  const [seen, setSeen] = useState(invoice.updatedAt);
  if (seen !== invoice.updatedAt) {
    setSeen(invoice.updatedAt);
    setFacts(initial);
  }
  const dirty = JSON.stringify(patchOf(facts)) !== JSON.stringify(patchOf(initial));

  const shown: [string, string | null][] = [
    [t("supplierName"), invoice.supplierName],
    [t("supplierOrgNo"), invoice.supplierOrgNo],
    [t("invoiceNumber"), invoice.invoiceNumber],
    [t("invoiceDate"), invoice.invoiceDate ? date(invoice.invoiceDate) : null],
    [t("ocr"), invoice.ocr],
    [t("bankgiro"), invoice.bankgiro],
    [t("plusgiro"), invoice.plusgiro],
    [t("yourReference"), invoice.yourReference],
  ];
  const anything = shown.some(([, v]) => v) || invoice.description;

  return (
    <section className="px-inset py-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className={LABEL}>{tWs("details")}</h3>
        {editable && (
          <button type="button" onClick={() => setOpen(!open)} className="text-sm font-medium text-accent hover:underline">
            {open ? tWs("closeDetails") : tWs("editDetails")}
          </button>
        )}
      </div>
      {editable && open ? (
        <div className="mt-3 space-y-3">
          <FactsForm facts={facts} set={(p) => setFacts((f) => ({ ...f, ...p }))} prefilled={invoice.prefilled} />
          <Button
            size="sm"
            disabled={!dirty}
            loading={save.busy}
            onClick={() =>
              void save.mutate(`/api/supplier-invoices/${invoice.id}`, {
                method: "PATCH",
                body: patchOf(facts),
                success: tDetail("saved"),
              })
            }
          >
            {tDetail("save")}
          </Button>
        </div>
      ) : anything ? (
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          {shown.map(([label, value]) =>
            value ? (
              <div key={label} className="min-w-0">
                <p className={LABEL}>{label}</p>
                <p className="mt-0.5 truncate text-sm">{value}</p>
              </div>
            ) : null,
          )}
          {invoice.description && <p className="col-span-full text-sm">{invoice.description}</p>}
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted">{tWs("noDetails")}</p>
      )}
    </section>
  );
}

/** How it is konterad and who has signed, once it is. */
function RowsSection({ invoice }: { invoice: SupplierInvoiceView }) {
  const t = useTranslations("invoices.kontering");
  const { dateTime } = useFormat();
  if (invoice.allocations.length === 0) return null;
  return (
    <section className="border-t border-border px-inset py-4">
      <h3 className={cn(LABEL, "mb-2")}>{t("title")}</h3>
      <ul className="divide-y divide-border text-sm">
        {invoice.allocations.map((a) => (
          <li key={a.id} className="flex items-start justify-between gap-4 py-2">
            <div className="min-w-0">
              <p className="truncate font-medium">
                {a.costCenterCode} - {a.costCenterName}
              </p>
              {(a.account || a.comment) && (
                <p className="truncate text-xs text-muted">
                  {[a.account && `${a.account}${a.accountName ? ` ${a.accountName}` : ""}`, a.comment]
                    .filter(Boolean)
                    .join(" - ")}
                </p>
              )}
              <p className="mt-0.5 text-xs">
                {a.approvedByName ? (
                  <span className="text-success">
                    {t("attestedBy", { name: a.approvedByName, when: dateTime(a.approvedAt!) })}
                  </span>
                ) : invoice.status === "PENDING_APPROVAL" ? (
                  <span className={a.canAttest ? "text-purple" : "text-muted"}>
                    {a.canAttest ? t("yoursToAttest") : t("awaitingAttest", { unit: a.resultUnit ?? "-" })}
                  </span>
                ) : null}
              </p>
            </div>
            <span className="shrink-0 tabular-nums">{a.amount == null ? t("whole") : formatSEK(a.amount)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The actions that are not the stage's own: moving it, taking a signature
 *  back, sending an attested one back, deleting it. Quiet, at the card's foot. */
function SecondaryActions({
  invoice,
  can,
  resultUnits,
  onDone,
}: {
  invoice: SupplierInvoiceView;
  can: InvoiceCapabilities;
  resultUnits: { id: string; name: string }[];
  onDone?: WorkspaceProps["onDone"];
}) {
  const t = useTranslations("invoices.workspace");
  const tAction = useTranslations("invoices.action");
  const tr = useTransition(invoice.id, onDone);
  const del = useMutation();
  const confirm = useConfirm();
  const [moving, setMoving] = useState(false);

  const assigned = invoice.status !== "INBOX";
  const show = (can.canAssign && assigned) || can.canWithdrawAttest || (can.canRequestChanges && invoice.status === "APPROVED") || (can.canDelete && assigned);
  if (!show) return null;

  async function explained(action: "request_changes" | "withdraw_attest") {
    const ok = await confirm({
      title: tAction(action),
      message: tAction(`confirm.${action}`),
      confirmLabel: tAction(action),
      comment: { label: tAction("commentLabel"), required: action === "request_changes" },
    });
    if (ok) await tr.run({ action, comment: ok.comment || undefined });
  }

  async function remove() {
    const ok = await confirm({
      title: tAction("delete"),
      message: tAction("confirm.delete"),
      confirmLabel: tAction("delete"),
      tone: "danger",
    });
    if (!ok) return;
    const res = await del.mutate(`/api/supplier-invoices/${invoice.id}`, {
      method: "DELETE",
      success: tAction("done.delete"),
      refresh: !onDone,
    });
    if (res && onDone) onDone("DELETED");
  }

  return (
    <section className="space-y-3 border-t border-border px-inset py-3">
      <div className="flex flex-wrap gap-2">
        {can.canAssign && assigned && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setMoving(!moving)}>
              {t("move")}
            </Button>
            <Button size="sm" variant="secondary" disabled={tr.busy} onClick={() => void tr.run({ action: "assign", resultUnitId: null })}>
              {t("unassign")}
            </Button>
          </>
        )}
        {can.canWithdrawAttest && (
          <Button size="sm" variant="secondary" disabled={tr.busy} onClick={() => void explained("withdraw_attest")}>
            {tAction("withdraw_attest")}
          </Button>
        )}
        {can.canRequestChanges && invoice.status === "APPROVED" && (
          <Button size="sm" variant="secondary" disabled={tr.busy} onClick={() => void explained("request_changes")}>
            {tAction("request_changes")}
          </Button>
        )}
        {can.canDelete && assigned && (
          <Button size="sm" variant="dangerOutline" loading={del.busy} onClick={() => void remove()}>
            {tAction("delete")}
          </Button>
        )}
      </div>
      {moving && (
        <div className="max-w-sm">
          <FieldGroup label={t("moveTo")}>
            <Combobox
              size="sm"
              options={resultUnits.filter((u) => u.id !== invoice.resultUnitId).map((u) => ({ value: u.id, label: u.name }))}
              value=""
              onChange={(v) => v && void tr.run({ action: "assign", resultUnitId: v })}
              placeholder={t("pickUnit")}
              searchPlaceholder={t("searchUnit")}
              aria-label={t("moveTo")}
            />
          </FieldGroup>
        </div>
      )}
    </section>
  );
}

const EVENT_TONE: Partial<Record<SupplierInvoiceView["events"][number]["type"], string>> = {
  APPROVED: "text-success",
  COST_CENTER_APPROVED: "text-success",
  CHANGES_REQUESTED: "text-danger",
  DECLINED: "text-danger",
};

function Timeline({ invoice }: { invoice: SupplierInvoiceView }) {
  const t = useTranslations("invoices.detail");
  const tEvent = useTranslations("invoices.event");
  const { dateTime } = useFormat();
  return (
    <section className="rounded-b-panel border-t border-border bg-canvas px-inset py-4">
      <h3 className={cn(LABEL, "mb-2")}>{t("history")}</h3>
      <ol className="space-y-1.5 text-xs">
        {invoice.events.map((e) => (
          <li key={e.id} className="grid grid-cols-[minmax(0,1fr)] gap-x-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <span className="tabular-nums text-muted">{dateTime(e.date)}</span>
            <span className="min-w-0">
              <span className={cn("font-medium", EVENT_TONE[e.type])}>
                {tEvent(e.type, { unit: e.toUnit ?? "-" })}
              </span>
              {e.actor && <span className="text-muted"> - {e.actor}</span>}
              {e.auto && (
                <span className="mt-0.5 block text-muted">
                  {tEvent(`auto.${e.auto.rule}`, { match: e.auto.match })}
                </span>
              )}
              {e.comment && <span className="mt-0.5 block text-muted">{e.comment}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
