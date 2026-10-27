"use client";

// One levfaktura: the PDF in the panel beside the page, and in the card what
// it says, whose it is, how it is konterad, and what has happened to it.
//
// Laid out like the utlägg page (expenses/[id]) and for the same reason: the
// document is what somebody came to read, so it has the panel, and the card
// reads top to bottom like the invoice it stands for.
//
// Editing is in place rather than behind an "Ändra" step. Whoever opens an
// invoice in the inkorg or in their unit's queue opens it to fill it in, so
// the fields are fields from the start, and one "Spara" saves them together.
// Sending it for attest saves first, so nobody has to remember to.
import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Combobox } from "@/components/ui/combobox";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput, Field, FieldGroup, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { IconCheck, IconX } from "@/components/ui/icons";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { InspectorSection } from "@/app/(app)/expenses/[id]/detail-sections";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useProgressRouter } from "@/components/shell/route-progress";
import { commaForm, parseOre, parseSEK } from "@/lib/domain/money";
import { submitBlocker, type InvoiceCapabilities } from "@/lib/domain/supplier-invoice";
import { formatSEK } from "@/lib/ui/format";
import { useFormat } from "@/lib/ui/use-format";
import { cn, uid } from "@/lib/ui/utils";
import type {
  PatchSupplierInvoice,
  TransitionSupplierInvoice,
} from "@/lib/api/schemas/supplier-invoice";
import type { AccountRecord, CostCenter } from "@/lib/domain/types";
import type { SupplierInvoiceView } from "@/lib/data/supplier-invoices";
import { InvoiceStatusPill } from "../invoices-client";

/** The small capitals every label on the card is set in, as on the utlägg page. */
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-muted";

export function InvoiceMissing() {
  const t = useTranslations("invoices.detail");
  return (
    <EmptyState
      title={t("missingTitle")}
      description={t("missingDescription")}
      action={<ButtonLink href="/invoices">{t("missingAction")}</ButtonLink>}
    />
  );
}

// ── The form's state ──────────────────────────────────────────────

interface Facts {
  description: string;
  supplierName: string;
  supplierOrgNo: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amount: string; // as typed, kronor
  ocr: string;
  bankgiro: string;
  plusgiro: string;
}

interface Row {
  id: string;
  costCenterCode: string;
  account: string;
  amount: string; // as typed, kronor
  comment: string;
}

/** An amount in kronor as the amount field writes one. */
const asInput = (sek: number | null) =>
  sek == null ? "" : commaForm((Math.round(sek * 100) / 100).toFixed(2));

function factsOf(i: SupplierInvoiceView): Facts {
  return {
    description: i.description ?? "",
    supplierName: i.supplierName ?? "",
    supplierOrgNo: i.supplierOrgNo ?? "",
    invoiceNumber: i.invoiceNumber ?? "",
    invoiceDate: i.invoiceDate,
    dueDate: i.dueDate,
    amount: asInput(i.amount),
    ocr: i.ocr ?? "",
    bankgiro: i.bankgiro ?? "",
    plusgiro: i.plusgiro ?? "",
  };
}

function rowsOf(i: SupplierInvoiceView): Row[] {
  if (i.allocations.length === 0) {
    // One empty row to start from, carrying the whole amount: most invoices go
    // to one cost centre, and the first question is which.
    return [{ id: uid(), costCenterCode: "", account: "", amount: asInput(i.amount), comment: "" }];
  }
  return i.allocations.map((a) => ({
    id: a.id,
    costCenterCode: a.costCenterCode,
    account: a.account,
    amount: asInput(a.amount),
    comment: a.comment ?? "",
  }));
}

/** The body PATCH takes, from what is on screen. Blank rows are dropped: a row
 *  with neither a cost centre nor an amount is a row nobody filled in. */
function patchOf(f: Facts, rows: Row[]): PatchSupplierInvoice {
  return {
    description: f.description,
    supplierName: f.supplierName,
    supplierOrgNo: f.supplierOrgNo,
    invoiceNumber: f.invoiceNumber,
    invoiceDate: f.invoiceDate,
    dueDate: f.dueDate,
    amount: f.amount.trim() ? parseOre(f.amount) : null,
    ocr: f.ocr,
    bankgiro: f.bankgiro,
    plusgiro: f.plusgiro,
    allocations: rows
      .filter((r) => r.costCenterCode)
      .map((r) => ({
        costCenterCode: r.costCenterCode,
        account: r.account,
        amount: parseOre(r.amount),
        comment: r.comment,
      })),
  };
}

// ── The page ──────────────────────────────────────────────────────

export function InvoiceDetailClient({
  invoice,
  can,
  costCenters,
  accounts,
  resultUnits,
}: {
  invoice: SupplierInvoiceView;
  /** Decided on the server. See invoiceCapabilities. */
  can: InvoiceCapabilities;
  costCenters: CostCenter[];
  accounts: AccountRecord[];
  resultUnits: { id: string; name: string }[];
}) {
  const t = useTranslations("invoices.detail");
  const tAction = useTranslations("invoices.action");
  const confirm = useConfirm();
  const router = useProgressRouter();
  const action = useMutation();
  const docs = useMutation();

  // Reset whenever the server sends a newer invoice, which is after every
  // save and every transition (the mutation refreshes). Keyed on updatedAt so
  // an edit in progress survives a refresh that changed nothing.
  const initialFacts = useMemo(() => factsOf(invoice), [invoice]);
  const initialRows = useMemo(() => rowsOf(invoice), [invoice]);
  const [facts, setFacts] = useState(initialFacts);
  const [rows, setRows] = useState(initialRows);
  const [seen, setSeen] = useState(invoice.updatedAt);
  if (seen !== invoice.updatedAt) {
    setSeen(invoice.updatedAt);
    setFacts(initialFacts);
    setRows(initialRows);
  }

  const dirty =
    JSON.stringify(patchOf(facts, rows)) !== JSON.stringify(patchOf(initialFacts, initialRows));
  const set = (patch: Partial<Facts>) => setFacts((f) => ({ ...f, ...patch }));

  const url = (path = "") => `/api/supplier-invoices/${invoice.id}${path}`;

  async function save(): Promise<boolean> {
    if (!dirty) return true;
    const body: PatchSupplierInvoice = patchOf(facts, rows);
    const ok = await action.mutate(url(), { method: "PATCH", body, key: "save", success: t("saved") });
    return ok !== null;
  }

  async function transition(
    act: TransitionSupplierInvoice["action"],
    extra: Omit<TransitionSupplierInvoice, "action"> = {},
  ) {
    const body: TransitionSupplierInvoice = { action: act, ...extra };
    await action.mutate(url("/transition"), { body, key: act, success: tAction(`done.${act}`) });
  }

  async function submit() {
    if (!(await save())) return;
    await transition("submit");
  }

  async function explained(act: "request_changes" | "discard", required: boolean) {
    const ok = await confirm({
      title: tAction(act),
      message: tAction(`confirm.${act}`),
      confirmLabel: tAction(act),
      tone: act === "discard" ? "danger" : "default",
      comment: { label: tAction("commentLabel"), required },
    });
    if (ok) await transition(act, { comment: ok.comment || undefined });
  }

  // What the submit is still waiting for, from what is on screen, so the
  // button can say so before it is pressed rather than after.
  const patch = patchOf(facts, rows);
  const blocker = can.canSubmit
    ? submitBlocker({
        supplierName: patch.supplierName ?? null,
        dueDate: patch.dueDate ?? null,
        amount: patch.amount ?? null,
        documentCount: invoice.documents.length,
        allocations: (patch.allocations ?? []).map((a) => ({ amount: a.amount, account: a.account })),
      })
    : null;

  const uploadDocument = useCallback(
    async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      await docs.mutate(url("/documents"), { body: form, key: "upload" });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docs.mutate, invoice.id],
  );

  async function removeDocument(id: string, filename: string) {
    const ok = await confirm({
      title: t("removeDocument"),
      message: t("removeDocumentConfirm", { filename }),
      confirmLabel: t("removeDocument"),
      tone: "danger",
    });
    if (ok) await docs.mutate(`/api/supplier-invoice-documents/${id}`, { method: "DELETE", key: id });
  }

  const title = invoice.supplierName || t("unnamed");
  const subtitle = [invoice.invoiceNumber && t("invoiceNo", { number: invoice.invoiceNumber }), invoice.resultUnitName]
    .filter(Boolean)
    .join(" - ");

  return (
    <PageShell width="content" title={title} subtitle={subtitle || undefined} back="/invoices">
      <ReceiptPanelSource
        documents={invoice.documents.map((d) => ({
          src: `/api/supplier-invoice-documents/${d.id}`,
          mimeType: d.mimeType,
          filename: d.filename,
          label: invoice.documents.length > 1 ? d.filename : undefined,
        }))}
        onFile={can.canEditDocuments ? uploadDocument : undefined}
        uploading={docs.pending === "upload"}
        multiple={can.canEditDocuments}
        uploadCopy={{
          lead: t("upload.lead"),
          leadShort: t("upload.leadShort"),
          action: t("upload.action"),
          addLabel: t("upload.add"),
        }}
        emptyTitle={t("noDocumentTitle")}
        emptyDescription={t("noDocument")}
      />

      {invoice.status === "CHANGES_REQUESTED" && <ReturnedNotice invoice={invoice} />}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-inset py-4">
          <span className="mt-1.5">
            <InvoiceStatusPill status={invoice.status} />
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {can.canEdit && (
              <Button
                variant={can.canSubmit ? "secondary" : "primary"}
                disabled={!dirty}
                loading={action.pending === "save"}
                onClick={() => void save()}
              >
                {t("save")}
              </Button>
            )}
            {can.canSubmit && (
              <Button
                disabled={Boolean(blocker) || action.busy}
                loading={action.pending === "submit"}
                onClick={() => void submit()}
              >
                {tAction("submit")}
              </Button>
            )}
            {can.canApprove && (
              <Button loading={action.pending === "approve"} onClick={() => void transition("approve")}>
                <IconCheck className="size-4" />
                {tAction("approve")}
              </Button>
            )}
            {can.canRequestChanges && (
              <Button
                variant="secondary"
                disabled={action.busy}
                onClick={() => void explained("request_changes", true)}
              >
                {tAction("request_changes")}
              </Button>
            )}
            {can.canRecall && (
              <Button
                variant="secondary"
                loading={action.pending === "recall"}
                onClick={() => void transition("recall")}
              >
                {tAction("recall")}
              </Button>
            )}
            {can.canRestore && (
              <Button
                variant="secondary"
                loading={action.pending === "restore"}
                onClick={() => void transition("restore")}
              >
                {tAction("restore")}
              </Button>
            )}
            {can.canDiscard && (
              <Button
                variant="dangerOutline"
                disabled={action.busy}
                onClick={() => void explained("discard", false)}
              >
                {tAction("discard")}
              </Button>
            )}
          </div>
          {blocker && (
            <p className="w-full text-right text-xs text-muted">{t(`blocker.${blocker.split(".")[1]}`)}</p>
          )}
        </div>

        {invoice.mail && <MailSection mail={invoice.mail} />}

        <FactsSection facts={facts} set={set} editable={can.canEdit} invoice={invoice} />

        <UnitSection
          invoice={invoice}
          canAssign={can.canAssign}
          resultUnits={resultUnits}
          busy={action.pending === "assign"}
          onAssign={(resultUnitId) => void transition("assign", { resultUnitId })}
        />

        <KonteringSection
          invoice={invoice}
          editable={can.canEdit}
          rows={rows}
          setRows={setRows}
          total={facts.amount.trim() ? parseSEK(facts.amount) : 0}
          costCenters={costCenters}
          accounts={accounts}
        />

        {invoice.documents.length > 0 && (
          <InspectorSection title={t("documents")}>
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
                      aria-label={t("removeDocument")}
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
          </InspectorSection>
        )}

        <Timeline invoice={invoice} />
      </Card>

      {/* After an invoice leaves a queue, the next one is a list away. */}
      {!can.canEdit && !can.canApprove && invoice.status !== "INBOX" && (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => router.push("/invoices")}>
            {t("backToList")}
          </Button>
        </div>
      )}
    </PageShell>
  );
}

/** The comment it was sent back with, above the card, where the person it went
 *  back to looks first. */
function ReturnedNotice({ invoice }: { invoice: SupplierInvoiceView }) {
  const t = useTranslations("invoices.detail");
  const last = [...invoice.events].reverse().find((e) => e.type === "CHANGES_REQUESTED");
  if (!last?.comment) return null;
  return (
    <Notice tone="warning">
      <p className="font-medium">{t("returnedTitle", { name: last.actor ?? "-" })}</p>
      <p>{last.comment}</p>
    </Notice>
  );
}

// ── Where it came from ────────────────────────────────────────────

/** The mail it was forwarded in: who sent it, and what they wrote above it,
 *  which is often the one line that says what the invoice is for. */
function MailSection({ mail }: { mail: NonNullable<SupplierInvoiceView["mail"]> }) {
  const t = useTranslations("invoices.mail");
  const { dateTime } = useFormat();
  return (
    <InspectorSection title={t("title")} aside={dateTime(mail.receivedAt)}>
      <div className="space-y-1 text-sm">
        <p className="truncate">
          <span className="text-muted">{t("from")} </span>
          {mail.fromName ? `${mail.fromName} <${mail.fromAddress}>` : mail.fromAddress}
        </p>
        {mail.subject && (
          <p className="truncate">
            <span className="text-muted">{t("subject")} </span>
            {mail.subject}
          </p>
        )}
        {mail.originalFrom && (
          <p className="truncate">
            <span className="text-muted">{t("originalFrom")} </span>
            {mail.originalFrom}
          </p>
        )}
        {mail.note && (
          <blockquote className="mt-2 whitespace-pre-line border-l-2 border-border pl-3 text-muted">
            {mail.note}
          </blockquote>
        )}
      </div>
    </InspectorSection>
  );
}

// ── What the invoice says ─────────────────────────────────────────

function FactsSection({
  facts,
  set,
  editable,
  invoice,
}: {
  facts: Facts;
  set: (patch: Partial<Facts>) => void;
  editable: boolean;
  invoice: SupplierInvoiceView;
}) {
  const t = useTranslations("invoices.field");
  const { date } = useFormat();

  if (!editable) {
    const show = (label: string, value: React.ReactNode) =>
      value ? (
        <div className="min-w-0">
          <p className={LABEL}>{label}</p>
          <p className="mt-0.5 truncate text-sm">{value}</p>
        </div>
      ) : null;
    return (
      <InspectorSection>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {show(t("amount"), invoice.amount != null && formatSEK(invoice.amount))}
          {show(t("dueDate"), invoice.dueDate && date(invoice.dueDate))}
          {show(t("invoiceDate"), invoice.invoiceDate && date(invoice.invoiceDate))}
          {show(t("invoiceNumber"), invoice.invoiceNumber)}
          {show(t("supplierOrgNo"), invoice.supplierOrgNo)}
          {show(t("ocr"), invoice.ocr)}
          {show(t("bankgiro"), invoice.bankgiro)}
          {show(t("plusgiro"), invoice.plusgiro)}
        </div>
        {invoice.description && <p className="mt-3 text-sm">{invoice.description}</p>}
      </InspectorSection>
    );
  }

  const text = (key: keyof Facts, opts: { wide?: boolean; inputMode?: "numeric" } = {}) => (
    <div className={cn(opts.wide && "sm:col-span-2")}>
      <Field label={t(key)}>
        <Input
          size="sm"
          value={facts[key]}
          inputMode={opts.inputMode}
          onChange={(e) => set({ [key]: e.target.value })}
        />
      </Field>
    </div>
  );

  return (
    <InspectorSection>
      <div className="grid gap-3 sm:grid-cols-2">
        {text("supplierName")}
        {text("supplierOrgNo")}
        <Field label={t("amount")}>
          <AmountInput size="sm" suffix="kr" value={facts.amount} onChange={(v) => set({ amount: v })} />
        </Field>
        {text("invoiceNumber")}
        <Field label={t("invoiceDate")}>
          <DateInput size="sm" value={facts.invoiceDate} onChange={(e) => set({ invoiceDate: e.target.value })} />
        </Field>
        <Field label={t("dueDate")}>
          <DateInput size="sm" value={facts.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
        </Field>
        {text("ocr", { inputMode: "numeric" })}
        {text("bankgiro")}
        {text("plusgiro")}
        {text("description", { wide: true })}
      </div>
    </InspectorSection>
  );
}

// ── Whose it is ───────────────────────────────────────────────────

function UnitSection({
  invoice,
  canAssign,
  resultUnits,
  busy,
  onAssign,
}: {
  invoice: SupplierInvoiceView;
  canAssign: boolean;
  resultUnits: { id: string; name: string }[];
  busy: boolean;
  onAssign: (resultUnitId: string | null) => void;
}) {
  const t = useTranslations("invoices.detail");

  if (!canAssign) {
    return (
      <InspectorSection title={t("unit")}>
        <p className="text-sm">{invoice.resultUnitName ?? <span className="text-muted">{t("noUnit")}</span>}</p>
      </InspectorSection>
    );
  }

  return (
    <InspectorSection
      title={t("unit")}
      action={
        invoice.resultUnitId ? (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => onAssign(null)}>
            {t("unassign")}
          </Button>
        ) : undefined
      }
    >
      {invoice.suggestedUnit && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-control bg-surface px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            {t("suggestion", {
              sender: invoice.mail?.originalFrom ?? "",
              unit: invoice.suggestedUnit.name,
            })}
          </span>
          <Button size="sm" variant="accentOutline" disabled={busy} onClick={() => onAssign(invoice.suggestedUnit!.id)}>
            {t("assignSuggested", { unit: invoice.suggestedUnit.name })}
          </Button>
        </div>
      )}
      <div className="max-w-sm">
        <FieldGroup label={t("assignTo")} hint={invoice.resultUnitId ? undefined : t("assignHint")}>
          <Combobox
            size="sm"
            options={resultUnits.map((u) => ({ value: u.id, label: u.name }))}
            value={invoice.resultUnitId ?? ""}
            onChange={(v) => v && onAssign(v)}
            placeholder={t("pickUnit")}
            searchPlaceholder={t("searchUnit")}
            aria-label={t("assignTo")}
          />
        </FieldGroup>
      </div>
    </InspectorSection>
  );
}

// ── How it is konterad ────────────────────────────────────────────

// Cost centre, account, amount, comment, and the narrow column the cross sits
// in. Stacked below sm, where four columns do not fit.
const COLS = "sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_8rem_minmax(0,1fr)_2rem]";

function KonteringSection({
  invoice,
  editable,
  rows,
  setRows,
  total,
  costCenters,
  accounts,
}: {
  invoice: SupplierInvoiceView;
  editable: boolean;
  rows: Row[];
  setRows: (rows: Row[]) => void;
  /** SEK. What the rows have to add up to. */
  total: number;
  costCenters: CostCenter[];
  accounts: AccountRecord[];
}) {
  const t = useTranslations("invoices.kontering");
  const { dateTime } = useFormat();

  if (!editable) {
    if (invoice.allocations.length === 0) {
      return (
        <InspectorSection title={t("title")}>
          <p className="text-sm text-muted">{t("none")}</p>
        </InspectorSection>
      );
    }
    return (
      <InspectorSection title={t("title")}>
        <ul className="divide-y divide-border text-sm">
          {invoice.allocations.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-4 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {a.costCenterCode} - {a.costCenterName}
                </p>
                <p className="truncate text-xs text-muted">
                  {a.account}
                  {a.accountName && ` - ${a.accountName}`}
                  {a.comment && ` - ${a.comment}`}
                </p>
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
              <span className="shrink-0 tabular-nums">{formatSEK(a.amount)}</span>
            </li>
          ))}
        </ul>
      </InspectorSection>
    );
  }

  const sum = rows.reduce((s, r) => s + parseSEK(r.amount), 0);
  const balanced = total > 0 && Math.abs(sum - total) < 0.005;
  const ccOptions = costCenters.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}`, short: c.code }));
  const accountOptions = accounts.map((a) => ({
    value: a.number,
    label: `${a.number} - ${a.name}`,
    short: a.number,
  }));

  const update = (id: string, patch: Partial<Row>) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // A new row is given what is left, the way the utlägg split does it: the
  // commonest split is "this much here and the rest there".
  const add = () => {
    const rest = total - sum;
    setRows([
      ...rows,
      { id: uid(), costCenterCode: "", account: "", amount: rest > 0.005 ? asInput(rest) : "", comment: "" },
    ]);
  };

  return (
    <InspectorSection title={t("title")}>
      <div className="space-y-2">
        <div className={cn("hidden gap-2 sm:grid", COLS)}>
          <span className={LABEL}>{t("costCenter")}</span>
          <span className={LABEL}>{t("account")}</span>
          <span className={cn(LABEL, "text-right")}>{t("amount")}</span>
          <span className={LABEL}>{t("comment")}</span>
          <span />
        </div>
        {rows.map((r) => (
          <div key={r.id} className={cn("grid gap-2 rounded-control border border-border p-2 sm:border-0 sm:p-0", COLS)}>
            <Combobox
              size="sm"
              options={ccOptions}
              value={r.costCenterCode}
              onChange={(v) => update(r.id, { costCenterCode: v })}
              placeholder={t("pickCostCenter")}
              searchPlaceholder={t("search")}
              aria-label={t("costCenter")}
            />
            <Combobox
              size="sm"
              options={accountOptions}
              value={r.account}
              onChange={(v) => update(r.id, { account: v })}
              placeholder={t("pickAccount")}
              searchPlaceholder={t("search")}
              aria-label={t("account")}
            />
            <AmountInput
              size="sm"
              value={r.amount}
              onChange={(v) => update(r.id, { amount: v })}
              inputClassName="text-right tabular-nums"
              aria-label={t("amount")}
            />
            <Input
              size="sm"
              value={r.comment}
              placeholder={t("commentPlaceholder")}
              onChange={(e) => update(r.id, { comment: e.target.value })}
              aria-label={t("comment")}
            />
            <button
              type="button"
              aria-label={t("removeRow")}
              disabled={rows.length <= 1}
              onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
              className="flex items-center justify-center rounded-control text-muted hover:bg-hover hover:text-danger disabled:opacity-30"
            >
              <IconX className="size-4" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button type="button" onClick={add} className="text-sm font-medium text-accent hover:underline">
            {t("addRow")}
          </button>
          <span
            className={cn(
              "text-sm tabular-nums",
              total === 0 ? "text-muted" : balanced ? "text-success" : "text-danger",
            )}
          >
            {total === 0
              ? t("noTotal")
              : balanced
                ? t("balanced", { sum: formatSEK(sum) })
                : t("unbalanced", { sum: formatSEK(sum), total: formatSEK(total) })}
          </span>
        </div>
      </div>
    </InspectorSection>
  );
}

// ── What has happened to it ───────────────────────────────────────

const EVENT_TONE: Partial<Record<SupplierInvoiceView["events"][number]["type"], string>> = {
  APPROVED: "text-success",
  COST_CENTER_APPROVED: "text-success",
  CHANGES_REQUESTED: "text-danger",
  DISCARDED: "text-danger",
};

function Timeline({ invoice }: { invoice: SupplierInvoiceView }) {
  const t = useTranslations("invoices.detail");
  const tEvent = useTranslations("invoices.event");
  const { dateTime } = useFormat();
  return (
    <section className="rounded-b-panel border-t border-border bg-canvas px-inset py-4">
      <h2 className={cn(LABEL, "mb-2")}>{t("history")}</h2>
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
