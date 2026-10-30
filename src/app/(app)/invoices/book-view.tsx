"use client";

// Kontera a levfaktura: the treasury's step once every share is attested,
// reached from the invoice's record by its Kontera button
// (/invoices/[id]/book). The supplier from Fortnox's register, what the
// invoice says (read off the PDF at the fördelning, to be checked here), and
// the kontering's lines, free as an utlägg's are. Saved, it is konterad, and the record
// offers to send it to Fortnox, as an utlägg's does once konterat. Nothing
// here talks to Fortnox's books.
//
// The PDF is not in here. The page puts it in the app's document panel
// beside it, the way an utlägg's receipt is.
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput, Field, Input } from "@/components/ui/field";
import { IconCheck, IconChevronRight } from "@/components/ui/icons";
import {
  BalanceChip,
  VoucherEditor,
  WarningChip,
  filledVoucherRows,
  type VoucherEditorRow,
} from "@/components/voucher-editor";
import { Notice } from "@/components/ui/notice";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { useQuery } from "@/components/shell/use-query";
import { isCompleteDate } from "@/lib/domain/date";
import { parseOre } from "@/lib/domain/money";
import {
  MAX_ROUNDING,
  PAYABLE_ACCOUNT,
  ROUNDING_ACCOUNT,
  bookedShares,
  exportBlocker,
} from "@/lib/domain/supplier-invoice";
import { giroMismatch, matchSupplier } from "@/lib/domain/payment-ref";
import type { FortnoxSupplier } from "@/lib/fortnox";
import { formatSEK } from "@/lib/ui/format";
import { cn } from "@/lib/ui/utils";
import type { InvoiceLine, PatchSupplierInvoice } from "@/lib/api/schemas/supplier-invoice";
import type { SupplierInvoiceView } from "@/lib/data/supplier-invoices";
import { asInput, useTransition, type WorkspaceProps } from "./invoice-shared";

// ── The form ──────────────────────────────────────────────────────
//
// Laid out as Fortnox's own leverantörsfaktura form, so a treasurer who knows
// that one finds everything where they expect it: the invoice's head in boxed
// fields (supplier, dates, OCR, number, total), the rest folded under
// "Ytterligare uppgifter", and the kontering as a debit and credit table that
// ends on the leverantörsskuld and says whether it balances. Each field of the
// head saves on its own as it is left. The lines are saved together, by Spara
// kontering, the way an utlägg's voucher is.

/** Kronor as the voucher table writes them, "1247,50", from öre. */
const kr = (ore: number) => (ore / 100).toFixed(2).replace(".", ",");
const toOre = (sek: number | null) => (sek == null ? null : Math.round(sek * 100));

/**
 * The lines the table opens on: the kontering as saved, or for one not made
 * yet, a line per attested share on its cost centre, on the account the same
 * supplier was booked on last, with the öresutjämning taken off the largest
 * (bookedShares) so the voucher balances from the start.
 */
function initialRows(invoice: SupplierInvoiceView): VoucherEditorRow[] {
  if (invoice.lines.length > 0) {
    return invoice.lines.map((l) => ({
      id: l.id,
      account: l.account,
      description: l.description ?? "",
      costCenterCode: l.costCenterCode ?? "",
      project: l.project ?? "",
      debit: l.debit ? kr(Math.round(l.debit * 100)) : "",
      credit: l.credit ? kr(Math.round(l.credit * 100)) : "",
    }));
  }
  const single = invoice.allocations.length === 1;
  const shares = invoice.allocations.map((a) => toOre(single ? invoice.amount : a.amount) ?? 0);
  const booked = bookedShares(shares, toOre(invoice.rounding) ?? 0);
  return invoice.allocations.map((a, i) => ({
    id: a.id,
    account: invoice.suggestedAccounts[a.id] ?? "",
    description: a.comment ?? "",
    costCenterCode: a.costCenterCode,
    project: "",
    debit: booked[i] ? kr(booked[i]) : "",
    credit: "",
  }));
}

/** The table's typed rows as the route takes them. */
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

/** A boxed field with its label above it, as one cell of the head. */
function BookField({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

/** An input that keeps what is typed until it is left, and saves it then. A
 *  save refused puts back what was there. */
function SavedInput({
  value,
  onSave,
  type = "text",
  amount,
  readOnly,
  align,
}: {
  value: string;
  onSave?: (value: string) => Promise<boolean>;
  type?: "text" | "date";
  amount?: boolean;
  readOnly?: boolean;
  align?: "right";
}) {
  const [draft, setDraft] = useState(value);
  // What the server says, once a save lands or the page refreshes.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  async function commit(next = draft) {
    if (!onSave || next === value) return;
    if (!(await onSave(next))) setDraft(value);
  }
  if (amount) {
    return (
      <AmountInput
        size="sm"
        suffix="kr"
        value={draft}
        onChange={setDraft}
        onBlur={() => void commit()}
        inputClassName="text-right"
      />
    );
  }
  if (type === "date") {
    return (
      <DateInput
        size="sm"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          // Saved as soon as it is a whole date. A date picked from the
          // calendar never focuses the field, so no blur would follow it.
          if (isCompleteDate(e.target.value)) void commit(e.target.value);
        }}
        // Left half typed, it goes back to what was saved. Emptied, it clears.
        onBlur={() => (draft === "" ? void commit() : !isCompleteDate(draft) && setDraft(value))}
        className="w-full"
      />
    );
  }
  return (
    <Input
      size="sm"
      value={draft}
      readOnly={readOnly}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      className={cn("w-full", align === "right" && "text-right tabular-nums", readOnly && "bg-surface text-muted")}
    />
  );
}

/** The record's own header, drawn at the top of the card. */
type CardProps = WorkspaceProps & { header?: React.ReactNode };

/**
 * Attested: the treasurer completes what Fortnox needs and saves it.
 *
 * Mostly confirming rather than typing. The supplier is picked from Fortnox's
 * own register, matched to the invoice's org number or giro where it can be
 * (usually already, when the document came in), and the accounts start on
 * what the same supplier was booked on last time. Both are saved the moment
 * they are picked, the same as the fields around them. A match or a suggestion
 * nobody has touched is saved by Spara. A bankgiro the register does not know
 * is said out loud here, and again in the question asked before it is sent,
 * because that is what invoice fraud looks like.
 */
export function BookPanel({ invoice, accounts, costCenters, projects, onDone, header }: CardProps) {
  const t = useTranslations("invoices.workspace");
  const tAction = useTranslations("invoices.action");
  const tFields = useTranslations("invoices.field");
  const tBook = useTranslations("invoices.book");
  const tErr = useTranslations("errors");
  const notify = useNotify();
  const save = useMutation();
  const creator = useMutation();
  const suppliers = useQuery<FortnoxSupplier[]>("/api/fortnox/suppliers");
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

  // Picked here and not yet back from the server. Cleared when it is, since
  // the invoice then says the same.
  const [picked, setPicked] = useState<{ supplier?: string }>({});
  const [seen, setSeen] = useState(invoice.updatedAt);
  if (seen !== invoice.updatedAt) {
    setSeen(invoice.updatedAt);
    setPicked({});
  }
  // The kontering, as it is being written. Kept here until Spara kontering.
  const [rows, setRows] = useState<VoucherEditorRow[]>(() => initialRows(invoice));
  const lines = linesOf(rows);

  const list = useMemo(() => suppliers.data ?? [], [suppliers.data]);
  const supplierNo =
    picked.supplier ?? invoice.fortnoxSupplierNumber ?? matchSupplier(invoice, list)?.number ?? "";
  const supplier = list.find((s) => s.number === supplierNo) ?? null;
  const mismatch = supplier ? giroMismatch(invoice, supplier) : null;

  const supplierBody = (number: string): PatchSupplierInvoice => ({
    fortnoxSupplierNumber: number || null,
    // The register's name, once one is picked: it is the name Fortnox will
    // print, so it is the one the archive should show.
    ...(list.find((s) => s.number === number) && { supplierName: list.find((s) => s.number === number)!.name }),
  });

  const put = async (body: PatchSupplierInvoice) =>
    (await save.mutate(url, { method: "PATCH", body })) !== null;

  async function commit(key: keyof PatchSupplierInvoice, raw: string) {
    const v = raw.trim();
    if (key !== "amount") return put({ [key]: v || null });
    if (!v) return put({ amount: null });
    const ore = parseOre(v);
    if (!Number.isFinite(ore) || ore <= 0) {
      notify.error(t("amountInvalid"));
      return false;
    }
    return put({ amount: ore });
  }

  async function pickSupplier(number: string) {
    setPicked((p) => ({ ...p, supplier: number }));
    await save.mutate(url, { method: "PATCH", body: supplierBody(number), key: "supplier" });
  }

  const roundingOre = toOre(invoice.rounding) ?? 0;
  const totalOre = toOre(invoice.amount) ?? 0;
  const blocker = exportBlocker({
    fortnoxSupplierNumber: supplierNo || null,
    invoiceNumber: invoice.invoiceNumber ?? "",
    invoiceDate: invoice.invoiceDate || null,
    dueDate: invoice.dueDate || null,
    amount: toOre(invoice.amount),
    rounding: roundingOre,
    shares: invoice.allocations.length === 1 ? [null] : invoice.allocations.map((a) => toOre(a.amount)),
    lines,
  });

  async function createInFortnox() {
    const created = await creator.mutate<FortnoxSupplier>("/api/fortnox/suppliers", {
      body: {
        name: invoice.supplierName,
        orgNo: invoice.supplierOrgNo || null,
        bankgiro: invoice.bankgiro || null,
        plusgiro: invoice.plusgiro || null,
      },
      success: t("supplierCreated"),
      refresh: false,
    });
    if (created) {
      suppliers.reload();
      await pickSupplier(created.number);
    }
  }

  async function book() {
    // The lines, and what is shown but not saved: a register match nobody
    // has touched. The route leaves out whatever already says the same.
    const unsaved: PatchSupplierInvoice = {
      ...(supplierNo !== (invoice.fortnoxSupplierNumber ?? "") && supplierBody(supplierNo)),
      lines,
    };
    const ok = await save.mutate(url, { method: "PATCH", body: unsaved, refresh: false });
    if (ok === null) return;
    await tr.run({ action: "book" });
  }

  const accountName = (number: string) => accounts.find((a) => a.number === number)?.name ?? "";
  const supplierOptions = list.map((s) => ({
    value: s.number,
    label: [s.name, s.orgNo, s.bankgiro && `BG ${s.bankgiro}`].filter(Boolean).join(" - "),
    short: s.name,
  }));

  // The voucher as it will be sent: the lines, the öresutjämning on its own
  // account, and the whole on the leverantörsskuld's credit side. Worked in
  // öre, so the sums meet exactly.
  const debitOre = lines.reduce((sum, l) => sum + l.debit, 0) + Math.max(roundingOre, 0);
  const creditOre = lines.reduce((sum, l) => sum + l.credit, 0) + totalOre + Math.max(-roundingOre, 0);
  const debit = debitOre / 100;
  const credit = creditOre / 100;
  const difference = (creditOre - debitOre) / 100;

  // Öresutjämning, either sign, typed as kronor: "-0,56".
  async function commitRounding(raw: string) {
    const v = raw.trim();
    if (!v) return put({ rounding: null });
    const ore = Math.round(Number(v.replace(/\s/g, "").replace(",", ".")) * 100);
    if (!Number.isFinite(ore) || Math.abs(ore) > MAX_ROUNDING) {
      notify.error(tBook("roundingInvalid"));
      return false;
    }
    return put({ rounding: ore || null });
  }

  const text = (key: "invoiceNumber" | "ocr" | "yourReference" | "ourReference") => (
    <SavedInput value={invoice[key] ?? ""} onSave={(v) => commit(key, v)} />
  );
  // The supplier's own details are the register's, not this invoice's to
  // change: shown as the picked supplier has them, and as the invoice printed
  // them until one is picked. A giro that disagrees is the warning below.
  const ofSupplier = (key: "bankgiro" | "plusgiro") => (
    <SavedInput readOnly value={(supplier ? supplier[key] : invoice[key]) ?? ""} />
  );

  const sumMismatch = blocker === "supplierInvoice.allocationSumMismatch";

  return (
    <>
      <Card>
        {header}
        <div className="@container space-y-5 px-inset py-5">
          {/* The head: who, when, which and how much. */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 @2xl:grid-cols-4">
            <BookField label={t("supplier")} className="col-span-2">
              <Combobox
                size="sm"
                options={supplierOptions}
                value={supplierNo}
                onChange={(v) => void pickSupplier(v)}
                placeholder={suppliers.loading ? t("loadingSuppliers") : t("pickSupplier")}
                searchPlaceholder={t("searchSupplier")}
                aria-label={t("supplier")}
              />
              {!supplier && !suppliers.loading && invoice.supplierName && (
                <span className="mt-1.5 block">
                  <Button size="sm" variant="secondary" loading={creator.busy} onClick={() => void createInFortnox()}>
                    {t("createSupplier", { name: invoice.supplierName })}
                  </Button>
                </span>
              )}
            </BookField>
            <BookField label={tFields("invoiceDate")}>
              <SavedInput type="date" value={invoice.invoiceDate} onSave={(v) => commit("invoiceDate", v)} />
            </BookField>
            <BookField label={tFields("dueDate")}>
              <SavedInput type="date" value={invoice.dueDate} onSave={(v) => commit("dueDate", v)} />
            </BookField>
            <BookField label={tFields("ocr")} className="col-span-2">
              {text("ocr")}
            </BookField>
            <BookField label={tFields("invoiceNumber")}>{text("invoiceNumber")}</BookField>
            <BookField label={tBook("total")}>
              <SavedInput amount value={asInput(invoice.amount)} onSave={(v) => commit("amount", v)} />
            </BookField>
          </div>

          {/* The rest, which the export carries but is seldom changed. */}
          <details open className="group border-t border-border pt-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold">
              <IconChevronRight className="size-4 transition-transform group-open:rotate-90" />
              {tBook("more")}
            </summary>
            {/* The two references in one column, as Fortnox stacks them. */}
            <div className="mt-3 grid grid-cols-2 items-start gap-x-4 gap-y-3 @2xl:grid-cols-4">
              <div className="col-span-2 space-y-3 @2xl:col-span-2">
                <BookField label={tBook("ourRef")}>{text("ourReference")}</BookField>
                <BookField label={tBook("supplierRef")}>{text("yourReference")}</BookField>
              </div>
              <BookField label={tFields("bankgiro")}>{ofSupplier("bankgiro")}</BookField>
              <BookField label={tFields("plusgiro")}>{ofSupplier("plusgiro")}</BookField>
            </div>
          </details>
        </div>
      </Card>

      {/* The kontering, in the voucher table an utlägg is booked in: free
          rows, spare ones under them, each with its own cost centre and
          project. It opens on the attested shares, and the leverantörsskuld
          is the locked row, credited with the whole. */}
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

        {/* Under a rule of its own: a figure about the invoice, not a row of
            the kontering above it. */}
        <div className="flex justify-end border-t border-border px-inset py-4">
          <BookField label={tBook("rounding")} className="w-40">
            <SavedInput
              value={invoice.rounding ? kr(roundingOre) : ""}
              onSave={commitRounding}
              align="right"
            />
          </BookField>
        </div>

        {mismatch && (
          <div className="px-inset pb-4">
            <Notice tone="warning">
              <p className="font-medium">{t("giroWarningTitle")}</p>
              <p>
                {t("giroWarning", {
                  field: tFields(mismatch.field).toLowerCase(),
                  invoice: mismatch.invoice,
                  register: mismatch.register ?? t("giroNone"),
                })}
              </p>
              <p className="mt-1">{tBook("giroAtSend")}</p>
            </Notice>
          </div>
        )}

        <CardBody className="flex flex-wrap items-center justify-between gap-3 border-t border-border">
          <BalanceChip balanced={difference === 0} difference={formatSEK(Math.abs(difference))} />

          <div className="flex flex-wrap items-center gap-2.5">
            {/* The amount booked is not what the split was attested against,
                which the balance chip is already saying. Only the unit can
                change its split, and changing it asks every signer again, so
                the way on is back to them. Any other reason gets the chip. */}
            {sumMismatch ? (
              <Button variant="secondary" disabled={tr.busy} onClick={() => void sendBack()}>
                {tBook("sendBack", { unit: invoice.resultUnitName ?? "-" })}
              </Button>
            ) : (
              blocker && <WarningChip>{tErr(blocker)}</WarningChip>
            )}
            <Button
              disabled={Boolean(blocker) || tr.busy || save.busy}
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

/**
 * An export whose outcome nobody knows: the request went to Fortnox and no
 * clear answer came back. Only a look in Fortnox settles it, so the panel asks
 * for exactly that, and offers the two answers.
 */
export function UncertainExport({ invoice, header }: { invoice: SupplierInvoiceView; header?: React.ReactNode }) {
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
            onClick={() => void m.mutate(url, { key: "not_created", body: { outcome: "not_created" } })}
          >
            {t("uncertainNotCreated")}
          </Button>
          <div className="flex items-end gap-2">
            <Field label={t("uncertainGivenNumber")}>
              <Input size="sm" inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} />
            </Field>
            <Button
              disabled={!/^\d+$/.test(number)}
              loading={m.pending === "created"}
              onClick={() => void m.mutate(url, { key: "created", body: { outcome: "created", givenNumber: number } })}
            >
              {t("uncertainCreated")}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

