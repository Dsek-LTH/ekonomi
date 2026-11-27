"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput, Field, FieldGroup, Input } from "@/components/ui/field";
import { IconCheck, IconChevronRight } from "@/components/ui/icons";
import {
  VoucherCostCenterPicker,
  VoucherEditor,
  WarningChip,
  filledVoucherRows,
  type VoucherEditorRow,
} from "@/components/voucher-editor";
import { Issue, Notice } from "@/components/ui/notice";
import { useConfirm } from "@/components/confirm-dialog";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useTypstSvg } from "@/components/typst/use-typst-svg";
import { useMutation } from "@/components/shell/use-mutation";
import { useLocalDraft } from "@/components/shell/use-local-draft";
import { useBookingPresence } from "@/components/shell/use-booking-presence";
import { OthersBookingNotice, UpdatedElsewhere } from "@/components/presence-notices";
import { useFormat } from "@/lib/ui/use-format";
import { useNotify } from "@/components/shell/notifications";
import { useQuery } from "@/components/shell/use-query";
import { isCompleteDate } from "@/lib/domain/date";
import { oreToSEK, parseOre, sekToInput, sekToOre } from "@/lib/domain/money";
import {
  MAX_ROUNDING,
  PAYABLE_ACCOUNT,
  ROUNDING_ACCOUNT,
  costTotal,
  duplicateBlocker,
  exportBlocker,
  isValidOcr,
  type InvoiceDuplicates,
} from "@/lib/domain/supplier-invoice";
import { giroMismatch, matchSupplier } from "@/lib/domain/payment-ref";
import type { FortnoxSupplier } from "@/lib/fortnox";
import { buildInvoiceCoverData, liveCoverFacts, type CoverFacts } from "@/lib/ui/invoice-cover";
import { cn } from "@/lib/ui/utils";
import { useReloadOnRegisterChange } from "@/lib/ui/fortnox-registers";
import { withCostCenterTag } from "@/lib/domain/cost-center-tag";
import type { InvoiceLine, PatchSupplierInvoice } from "@/lib/api/schemas/supplier-invoice";
import type { SupplierInvoiceView } from "@/lib/data/supplier-invoices";
import { useInvoicePanelDocuments, useTransition, type WorkspaceProps } from "./invoice-shared";

const toOre = (sek: number | null) => (sek == null ? null : sekToOre(sek));

/** Opening lines: the saved kontering, else a line per attested share. Shares exclude öresutjämning, so the voucher balances. `isLocal` tags a local cost centre's code onto a row's text, as the expense kontering does (lib/domain/cost-center-tag), so the row reads as Fortnox will get it. */
function initialRows(
  invoice: SupplierInvoiceView,
  isLocal: (code: string) => boolean,
): VoucherEditorRow[] {
  if (invoice.lines.length > 0) {
    return invoice.lines.map((l) => ({
      id: l.id,
      account: l.account,
      description: l.description ?? "",
      costCenterCode: l.costCenterCode ?? "",
      project: l.project ?? "",
      debit: l.debit ? sekToInput(l.debit) : "",
      credit: l.credit ? sekToInput(l.credit) : "",
    }));
  }
  const single = invoice.allocations.length === 1;
  const amount = toOre(invoice.amount);
  const booked = invoice.allocations.map((a) =>
    single
      ? amount == null
        ? 0
        : costTotal(amount, toOre(invoice.rounding))
      : (toOre(a.amount) ?? 0),
  );
  return invoice.allocations.map((a, i) => ({
    id: a.id,
    account: invoice.suggestedAccounts[a.id] ?? "",
    description: isLocal(a.costCenterCode)
      ? withCostCenterTag(a.comment ?? "", a.costCenterCode)
      : (a.comment ?? ""),
    costCenterCode: a.costCenterCode,
    project: "",
    debit: booked[i] ? sekToInput(oreToSEK(booked[i])) : "",
    credit: "",
  }));
}

function linesOf(rows: VoucherEditorRow[]): InvoiceLine[] {
  const amount = (v: string) => (v.trim() ? parseOre(v) : 0);
  return filledVoucherRows(rows).map((r) => ({
    account: r.account.trim(),
    costCenterCode: r.costCenterCode || null,
    project: r.project || null,
    description: r.description.trim() || null,
    debit: amount(r.debit),
    credit: amount(r.credit),
  }));
}

/** A head field, controlled by BookPanel so the warnings and the attest page follow every keystroke. Saved with the kontering at Bokför. */
function HeadInput({
  value,
  onChange,
  onLeave,
  type = "text",
  amount,
  readOnly,
  align,
  invalid,
}: {
  value: string;
  onChange?: (value: string) => void;
  /** The field was left (or a whole date picked), so its warning may show. */
  onLeave?: () => void;
  type?: "text" | "date";
  amount?: boolean;
  readOnly?: boolean;
  align?: "right";
  invalid?: boolean;
}) {
  if (amount) {
    return (
      // Full: the head's fields line up in columns against the document beside them.
      <AmountInput
        size="sm"
        width="full"
        suffix="kr"
        value={value}
        onChange={(v) => onChange?.(v)}
        onBlur={onLeave}
        inputClassName="text-right"
      />
    );
  }
  if (type === "date") {
    return (
      <DateInput
        size="sm"
        width="full"
        value={value}
        onChange={(e) => {
          onChange?.(e.target.value);
          // A date picked from the calendar never focuses the field, so no blur follows.
          if (isCompleteDate(e.target.value)) onLeave?.();
        }}
        onBlur={onLeave}
        className="w-full"
      />
    );
  }
  return (
    <Input
      size="sm"
      value={value}
      readOnly={readOnly}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange?.(e.target.value)}
      onBlur={onLeave}
      className={cn(
        "w-full",
        invalid && "border-warning",
        align === "right" && "text-right tabular-nums",
        readOnly && "bg-surface text-muted",
      )}
    />
  );
}

type HeadKey =
  | "invoiceNumber"
  | "ocr"
  | "yourReference"
  | "ourReference"
  | "invoiceDate"
  | "dueDate"
  | "amount"
  | "rounding";
type Head = Record<HeadKey, string>;

/** The head fields as their inputs show them. */
const headOf = (i: SupplierInvoiceView): Head => ({
  invoiceNumber: i.invoiceNumber ?? "",
  ocr: i.ocr ?? "",
  yourReference: i.yourReference ?? "",
  ourReference: i.ourReference ?? "",
  invoiceDate: i.invoiceDate ?? "",
  dueDate: i.dueDate ?? "",
  amount: sekToInput(i.amount),
  rounding: i.rounding ? sekToInput(i.rounding) : "",
});

/** Öre, null for empty, undefined for something that is not an amount. */
function parseAmount(raw: string): number | null | undefined {
  const v = raw.trim();
  if (!v) return null;
  const ore = parseOre(v);
  return Number.isFinite(ore) && ore > 0 ? ore : undefined;
}

/** Öresutjämning in öre, either sign, under a krona. Null for none, undefined for something else. */
function parseRounding(raw: string): number | null | undefined {
  const v = raw.trim();
  if (!v) return null;
  const ore = Math.round(Number(v.replace(/\s/g, "").replace(",", ".")) * 100);
  return Number.isFinite(ore) && Math.abs(ore) <= MAX_ROUNDING ? ore || null : undefined;
}

type CardProps = WorkspaceProps & { header?: React.ReactNode; cover?: CoverFacts | null };

/** Attested: the treasurer completes what Fortnox needs. A bankgiro the register does not know is flagged here and again before sending (invoice fraud). */
export function BookPanel({
  invoice,
  accounts,
  costCenters,
  projects,
  onDone,
  header,
  cover = null,
}: CardProps) {
  const t = useTranslations("invoices.workspace");
  const tAction = useTranslations("invoices.action");
  const tFields = useTranslations("invoices.field");
  const tBook = useTranslations("invoices.book");
  const tVoucher = useTranslations("book");
  const tErr = useTranslations("errors");
  const tPresence = useTranslations("invoices.presence");
  const tDraft = useTranslations("common.draft");
  const { list: listNames } = useFormat();
  const notify = useNotify();
  const save = useMutation();
  const suppliers = useQuery<FortnoxSupplier[]>("/api/fortnox/suppliers");
  // A supplier missing from the register is added in Fortnox: read it again on the way back, or after a sync.
  useReloadOnRegisterChange(suppliers.reload);
  const tr = useTransition(invoice.id, onDone);
  const confirm = useConfirm();

  async function sendBack() {
    const ok = await confirm({
      title: tBook("sendBack", { unit: invoice.resultUnitName ?? "-" }),
      message: tAction("confirm.request_changes"),
      confirmLabel: tAction("request_changes"),
      comment: { label: tAction("commentLabel"), required: true },
    });
    if (ok) await tr.run({ action: "request_changes", comment: ok.comment });
  }
  const url = `/api/supplier-invoices/${invoice.id}`;

  // What is typed (draft) and what the server has (saved). Nothing is saved until Bokför, which sends the head and
  // the rows together. Everything below is worked from the draft; a reload from elsewhere starts both over.
  const [draft, setDraft] = useState<Head>(() => headOf(invoice));
  const [saved, setSaved] = useState<Head>(() => headOf(invoice));
  const [touched, setTouched] = useState<ReadonlySet<HeadKey>>(new Set());
  const [picked, setPicked] = useState<{ supplier?: string }>({});
  const [seen, setSeen] = useState(invoice.updatedAt);
  // Ytterligare uppgifter opens by itself only when the invoice already uses one of them.
  const [moreOpen] = useState(() => Boolean(invoice.ourReference || invoice.yourReference));
  const isLocal = (code: string) =>
    costCenters.some((c) => c.code === code && c.source === "LOCAL");
  const [rows, setRows] = useState<VoucherEditorRow[]>(() => initialRows(invoice, isLocal));
  // What the rows say when the page opens. Compared as lines, so the editor's own spare rows (added on mount) and an
  // edit typed back to what it was do not count as unsaved work.
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(linesOf(initialRows(invoice, isLocal))),
  );
  // The version this kontering is typed on. A save moves it, so a Bokför whose transition failed can save again.
  const [version, setVersion] = useState(invoice.updatedAt);
  if (seen !== invoice.updatedAt) {
    setSeen(invoice.updatedAt);
    setPicked({});
    setDraft(headOf(invoice));
    setSaved(headOf(invoice));
    setRows(initialRows(invoice, isLocal));
    setBaseline(JSON.stringify(linesOf(initialRows(invoice, isLocal))));
    setVersion(invoice.updatedAt);
  }
  const lines = linesOf(rows);
  const rowsChanged = JSON.stringify(lines) !== baseline;
  // Who else has the kontering open, and whether somebody saved it meanwhile (as on the utlägg's booking screen).
  const presence = useBookingPresence(`/api/supplier-invoices/${invoice.id}/presence`, version);

  const list = useMemo(() => suppliers.data ?? [], [suppliers.data]);
  const supplierNo =
    picked.supplier ?? invoice.fortnoxSupplierNumber ?? matchSupplier(invoice, list)?.number ?? "";
  const supplier = list.find((s) => s.number === supplierNo) ?? null;
  const mismatch = supplier ? giroMismatch(invoice, supplier) : null;

  const supplierBody = (number: string): PatchSupplierInvoice => ({
    fortnoxSupplierNumber: number || null,
    // The register's name is the one Fortnox prints.
    ...(list.find((s) => s.number === number) && {
      supplierName: list.find((s) => s.number === number)!.name,
    }),
  });

  /** The PATCH for one field, or null when it cannot be saved as typed (said, unless it is a half-typed date). */
  function bodyFor(key: HeadKey, raw: string): PatchSupplierInvoice | null {
    const v = raw.trim();
    if (key === "amount") {
      const ore = parseAmount(v);
      if (ore === undefined) notify.error(t("amountInvalid"));
      return ore === undefined ? null : { amount: ore };
    }
    if (key === "rounding") {
      const ore = parseRounding(v);
      if (ore === undefined) notify.error(tBook("roundingInvalid"));
      return ore === undefined ? null : { rounding: ore };
    }
    if ((key === "invoiceDate" || key === "dueDate") && v && !isCompleteDate(v)) return null;
    return { [key]: v || null };
  }

  const edit = (key: HeadKey) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const leave = (key: HeadKey) => setTouched((s) => (s.has(key) ? s : new Set(s).add(key)));

  // Worked from the draft. A date counts once whole; until then the saved one stands.
  const liveDate = (key: "invoiceDate" | "dueDate") =>
    draft[key] === "" || isCompleteDate(draft[key]) ? draft[key] : saved[key];
  const amountOre = parseAmount(draft.amount) ?? null;
  const typedRounding = parseRounding(draft.rounding);
  const roundingOre =
    (typedRounding === undefined ? parseRounding(saved.rounding) : typedRounding) ?? 0;
  const totalOre = amountOre ?? 0;
  // A copy of an invoice already here or in Fortnox is deleted, not konterad. Asked of what is typed, once both are there.
  const typedNumber = draft.invoiceNumber.trim();
  const duplicates = useQuery<InvoiceDuplicates>(
    supplierNo && typedNumber
      ? `/api/supplier-invoices/${invoice.id}/duplicates?${new URLSearchParams({
          supplier: supplierNo,
          number: typedNumber,
        })}`
      : null,
    { debounceMs: 400, keepPrevious: false },
  );
  const copy = supplierNo && typedNumber ? duplicates.data : null;
  const blocker =
    exportBlocker({
      fortnoxSupplierNumber: supplierNo || null,
      invoiceNumber: draft.invoiceNumber,
      invoiceDate: liveDate("invoiceDate") || null,
      dueDate: liveDate("dueDate") || null,
      amount: amountOre,
      ocr: draft.ocr.trim() || null,
      rounding: roundingOre,
      shares:
        invoice.allocations.length === 1 ? [null] : invoice.allocations.map((a) => toOre(a.amount)),
      lines,
    }) ?? (copy ? duplicateBlocker(copy) : null);

  // The attest page, drawn here from what is typed, as it will be sent.
  const coverData = cover
    ? buildInvoiceCoverData(
        liveCoverFacts(cover, {
          supplierName: supplier?.name ?? cover.supplierName,
          invoiceNumber: draft.invoiceNumber.trim() || null,
          invoiceDate: liveDate("invoiceDate"),
          dueDate: liveDate("dueDate"),
          amount: totalOre,
        }),
      )
    : null;
  const svg = useTypstSvg("invoiceCover", coverData);
  const documents = useInvoicePanelDocuments(invoice, cover ? { svg } : undefined);

  const supplierChanged = supplierNo !== (invoice.fortnoxSupplierNumber ?? "");
  // A supplier matched automatically is not something the reader typed, so only a pick counts.
  const dirty =
    rowsChanged ||
    (picked.supplier !== undefined && supplierChanged) ||
    (Object.keys(draft) as HeadKey[]).some((key) => draft[key] !== saved[key]);

  // Kept as it is typed (use-local-draft.ts), so leaving by any route comes back to the same kontering. Never asks.
  const draftStore = useLocalDraft({
    name: `invoice-book:${invoice.id}`,
    version: invoice.updatedAt,
    value: { head: draft, rows, supplier: picked.supplier },
    dirty,
    restore: (kept) => {
      setDraft(kept.head);
      setRows(kept.rows);
      setPicked({ supplier: kept.supplier });
    },
  });
  function startOver() {
    setDraft(saved);
    setRows(initialRows(invoice, isLocal));
    setPicked({});
    draftStore.dismiss();
  }

  async function book() {
    // Somebody else has it open. Not a lock, but whoever saves second starts over.
    const { others } = presence;
    if (others.length > 0) {
      const ok = await confirm({
        title: tPresence("confirmTitle"),
        message: tPresence("confirmMessage", {
          names: listNames(others.map((o) => o.name)),
          count: others.length,
        }),
        confirmLabel: tBook("save"),
      });
      if (!ok) return;
    }
    // The head goes with the kontering in one PATCH. The route leaves out what already matches.
    const typed: PatchSupplierInvoice = {};
    for (const key of Object.keys(draft) as HeadKey[]) {
      if (draft[key] === saved[key]) continue;
      const body = bodyFor(key, draft[key]);
      if (body === null) return;
      Object.assign(typed, body);
    }
    const unsaved: PatchSupplierInvoice = {
      ...typed,
      ...(supplierChanged && supplierBody(supplierNo)),
      lines,
      expectedUpdatedAt: version,
    };
    // Our own save moves the version: heartbeats wait, or they would report it as somebody else's.
    presence.pause();
    const ok = await save.mutate<{ updatedAt?: string }>(url, {
      method: "PATCH",
      body: unsaved,
      refresh: false,
    });
    if (ok === null) {
      // Possibly a 409 because somebody got there first: asking at once turns it into the reload dialog.
      presence.resume();
      return;
    }
    // Nothing changed is a 204 with no body: the version stands.
    setVersion(ok.updatedAt ?? version);
    setSaved(draft);
    draftStore.clear();
    if (!(await tr.run({ action: "book" }))) presence.resume();
  }

  const accountName = (number: string) => accounts.find((a) => a.number === number)?.name ?? "";
  const supplierOptions = list.map((s) => ({
    value: s.number,
    label: [s.name, s.orgNo, s.bankgiro && `BG ${s.bankgiro}`].filter(Boolean).join(" - "),
    short: s.name,
  }));

  // Worked in öre so the sums meet exactly.
  const debitOre = lines.reduce((sum, l) => sum + l.debit, 0) + Math.max(roundingOre, 0);
  const creditOre =
    lines.reduce((sum, l) => sum + l.credit, 0) + totalOre + Math.max(-roundingOre, 0);
  const debit = debitOre / 100;
  const credit = creditOre / 100;

  // Said once the field has been left, so a number still being typed is not called wrong.
  const badOcr =
    draft.ocr.trim() !== "" && !isValidOcr(draft.ocr) && (touched.has("ocr") || saved.ocr !== "");
  const field = (key: HeadKey) => ({
    value: draft[key],
    onChange: edit(key),
    onLeave: () => leave(key),
  });
  const text = (key: "invoiceNumber" | "ocr" | "yourReference" | "ourReference") => (
    <HeadInput {...field(key)} invalid={key === "ocr" && badOcr} />
  );
  // Supplier details are the register's, not the invoice's, once one is picked.
  const ofSupplier = (key: "bankgiro" | "plusgiro") => (
    <HeadInput readOnly value={(supplier ? supplier[key] : invoice[key]) ?? ""} />
  );

  const sumMismatch = blocker === "supplierInvoice.allocationSumMismatch";

  return (
    <>
      <ReceiptPanelSource documents={documents} />
      {presence.stale ? (
        <UpdatedElsewhere by={presence.stale.by} copy="invoices.presence" />
      ) : (
        <OthersBookingNotice others={presence.others} copy="invoices.presence" />
      )}
      {draftStore.restored && (
        <Notice tone="info">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {tDraft("restored")}
            <Button size="sm" variant="secondary" onClick={startOver}>
              {tDraft("discard")}
            </Button>
          </span>
        </Notice>
      )}
      <Card>
        {header}
        {/* Three rows from 36rem, two columns under it: the head is checked against the PDF beside it, not read. */}
        <div className="@container space-y-3 px-inset py-4">
          <div className="grid grid-cols-2 gap-x-3 gap-y-3 @xl:grid-cols-4">
            <FieldGroup label={t("supplier")} className="col-span-2" requirement="required">
              <Combobox
                size="sm"
                options={supplierOptions}
                value={supplierNo}
                onChange={(v) => setPicked((p) => ({ ...p, supplier: v }))}
                placeholder={suppliers.loading ? t("loadingSuppliers") : t("pickSupplier")}
                searchPlaceholder={t("searchSupplier")}
                aria-label={t("supplier")}
              />
              {/* Suppliers are added in Fortnox, not here. */}
              {!supplier && !suppliers.loading && invoice.supplierName && (
                <p className="mt-1 truncate text-xs text-muted" title={invoice.supplierName}>
                  {t("supplierNotInRegister", { name: invoice.supplierName })}
                </p>
              )}
              {/* Money to an account the register does not know: said on the supplier it is about, and again at send. */}
              {mismatch && (
                <Issue tone="danger" className="mt-1">
                  {t("giroWarning", {
                    field: tFields(mismatch.field).toLowerCase(),
                    invoice: mismatch.invoice,
                    register: mismatch.register ?? t("giroNone"),
                  })}{" "}
                  {tBook("giroAtSend")}
                </Issue>
              )}
            </FieldGroup>
            <Field label={tBook("total")} requirement="required">
              <HeadInput amount {...field("amount")} />
            </Field>
            <Field label={tBook("rounding")} requirement="optional">
              <HeadInput {...field("rounding")} align="right" />
            </Field>
            <Field label={tFields("invoiceDate")} requirement="required">
              <HeadInput type="date" {...field("invoiceDate")} />
            </Field>
            <Field label={tFields("dueDate")} requirement="required">
              <HeadInput type="date" {...field("dueDate")} />
            </Field>
            <Field label={tFields("invoiceNumber")} requirement="required">
              {text("invoiceNumber")}
              {copy?.local ? (
                <Issue tone="danger" className="mt-1">
                  <span>
                    {tBook("duplicateLocal")}{" "}
                    <Link href={`/invoices/${copy.local.id}`} className="link">
                      {copy.local.reference ?? tBook("duplicateOpen")}
                    </Link>
                  </span>
                </Issue>
              ) : copy?.fortnox ? (
                <Issue tone="danger" className="mt-1">
                  {tBook("duplicateFortnox", { number: copy.fortnox })}
                </Issue>
              ) : (
                copy &&
                !copy.fortnoxChecked && (
                  <Issue className="mt-1">{tBook("duplicateUnchecked")}</Issue>
                )
              )}
            </Field>
            <Field
              label={tFields("ocr")}
              requirement="optional"
              error={badOcr ? tErr("supplierInvoice.badOcr") : undefined}
            >
              {text("ocr")}
            </Field>
            <FieldGroup
              label={tVoucher("allCostCenter")}
              className="col-span-2"
              requirement="optional"
            >
              <VoucherCostCenterPicker rows={rows} onChange={setRows} costCenters={costCenters} />
            </FieldGroup>
          </div>

          {/* Rarely needed, so folded unless the invoice already uses one of them. */}
          <details open={moreOpen} className="group border-t border-border pt-2.5">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground">
              <IconChevronRight className="size-4 transition-transform group-open:rotate-90" />
              {tBook("more")}
            </summary>
            <div className="mt-2.5 grid grid-cols-2 items-start gap-x-3 gap-y-3 @xl:grid-cols-4">
              <Field label={tBook("ourRef")} requirement="optional">
                {text("ourReference")}
              </Field>
              <Field label={tBook("supplierRef")} requirement="optional">
                {text("yourReference")}
              </Field>
              <Field label={tFields("bankgiro")}>{ofSupplier("bankgiro")}</Field>
              <Field label={tFields("plusgiro")}>{ofSupplier("plusgiro")}</Field>
            </div>
          </details>
        </div>
      </Card>

      <Card>
        <VoucherEditor
          rows={rows}
          onChange={setRows}
          accounts={accounts}
          costCenters={costCenters}
          projects={projects}
          locked={[
            {
              account: String(PAYABLE_ACCOUNT),
              accountName: accountName(String(PAYABLE_ACCOUNT)) || tBook("payable"),
              debit: 0,
              credit: totalOre / 100,
              hint: tBook("payableHint"),
              label: tBook("payable"),
            },
            ...(roundingOre
              ? [
                  {
                    account: String(ROUNDING_ACCOUNT),
                    accountName: accountName(String(ROUNDING_ACCOUNT)) || tBook("rounding"),
                    debit: Math.max(roundingOre, 0) / 100,
                    credit: Math.max(-roundingOre, 0) / 100,
                    hint: tBook("roundingHint"),
                    label: tBook("rounding"),
                  },
                ]
              : []),
          ]}
          totalDebit={debit}
          totalCredit={credit}
        />

        <CardBody className="flex flex-wrap items-center justify-end gap-3 border-t border-divider">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Only the unit can change its split, which asks every signer again. */}
            {sumMismatch ? (
              <Button variant="secondary" disabled={tr.busy} onClick={() => void sendBack()}>
                {tBook("sendBack", { unit: invoice.resultUnitName ?? "-" })}
              </Button>
            ) : (
              blocker && <WarningChip>{tErr(blocker)}</WarningChip>
            )}
            <Button
              disabled={Boolean(blocker) || tr.busy || save.busy || Boolean(presence.stale)}
              loading={tr.pending === "book"}
              onClick={() => void book()}
            >
              <IconCheck className="size-4" />
              {tBook("save")}
            </Button>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

/** An export with unknown outcome: only a look in Fortnox settles it. */
export function UncertainExport({
  invoice,
  header,
}: {
  invoice: SupplierInvoiceView;
  header?: React.ReactNode;
}) {
  const t = useTranslations("invoices.workspace");
  const m = useMutation();
  const [number, setNumber] = useState("");
  const url = `/api/supplier-invoices/${invoice.id}/export/release`;
  return (
    <Card>
      {header}
      <div className="space-y-3 px-inset py-4">
        <Notice tone="warning">
          <p className="font-medium">{t("uncertainTitle")}</p>
          <p>{t("uncertainBody", { number: invoice.invoiceNumber ?? "-" })}</p>
        </Notice>
        <div className="flex flex-wrap items-end gap-2">
          <Button
            variant="secondary"
            loading={m.pending === "not_created"}
            onClick={() =>
              void m.mutate(url, {
                key: "not_created",
                body: { outcome: "not_created" },
              })
            }
          >
            {t("uncertainNotCreated")}
          </Button>
          <div className="flex items-end gap-2">
            <Field label={t("uncertainGivenNumber")}>
              <Input
                size="sm"
                inputMode="numeric"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </Field>
            <Button
              disabled={!/^\d+$/.test(number)}
              loading={m.pending === "created"}
              onClick={() =>
                void m.mutate(url, {
                  key: "created",
                  body: { outcome: "created", givenNumber: number },
                })
              }
            >
              {t("uncertainCreated")}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
