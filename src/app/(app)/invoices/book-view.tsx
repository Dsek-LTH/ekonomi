"use client";

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
  VoucherCostCenterPicker,
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
import { oreToSEK, parseOre, sekToInput, sekToOre } from "@/lib/domain/money";
import {
  MAX_ROUNDING,
  PAYABLE_ACCOUNT,
  ROUNDING_ACCOUNT,
  costTotal,
  exportBlocker,
} from "@/lib/domain/supplier-invoice";
import { giroMismatch, matchSupplier } from "@/lib/domain/payment-ref";
import type { FortnoxSupplier } from "@/lib/fortnox";
import { formatSEK } from "@/lib/ui/format";
import { cn } from "@/lib/ui/utils";
import type { InvoiceLine, PatchSupplierInvoice } from "@/lib/api/schemas/supplier-invoice";
import type { SupplierInvoiceView } from "@/lib/data/supplier-invoices";
import { useTransition, type WorkspaceProps } from "./invoice-shared";

const toOre = (sek: number | null) => (sek == null ? null : sekToOre(sek));

/** Opening lines: the saved kontering, else a line per attested share. Shares exclude öresutjämning, so the voucher balances. */
function initialRows(invoice: SupplierInvoiceView): VoucherEditorRow[] {
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
    description: a.comment ?? "",
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

function BookField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

/** Saves on blur; a refused save restores the saved value. */
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
          // A date picked from the calendar never focuses the field, so no blur follows.
          if (isCompleteDate(e.target.value)) void commit(e.target.value);
        }}
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
      className={cn(
        "w-full",
        align === "right" && "text-right tabular-nums",
        readOnly && "bg-surface text-muted",
      )}
    />
  );
}

type CardProps = WorkspaceProps & { header?: React.ReactNode };

/** Attested: the treasurer completes what Fortnox needs. A bankgiro the register does not know is flagged here and again before sending (invoice fraud). */
export function BookPanel({ invoice, accounts, costCenters, projects, onDone, header }: CardProps) {
  const t = useTranslations("invoices.workspace");
  const tAction = useTranslations("invoices.action");
  const tFields = useTranslations("invoices.field");
  const tBook = useTranslations("invoices.book");
  const tVoucher = useTranslations("book");
  const tErr = useTranslations("errors");
  const notify = useNotify();
  const save = useMutation();
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

  const [picked, setPicked] = useState<{ supplier?: string }>({});
  const [seen, setSeen] = useState(invoice.updatedAt);
  if (seen !== invoice.updatedAt) {
    setSeen(invoice.updatedAt);
    setPicked({});
  }
  const [rows, setRows] = useState<VoucherEditorRow[]>(() => initialRows(invoice));
  const lines = linesOf(rows);

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
    ocr: invoice.ocr ?? null,
    rounding: roundingOre,
    shares:
      invoice.allocations.length === 1 ? [null] : invoice.allocations.map((a) => toOre(a.amount)),
    lines,
  });

  async function book() {
    // The route leaves out lines that already match.
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

  // Worked in öre so the sums meet exactly.
  const debitOre = lines.reduce((sum, l) => sum + l.debit, 0) + Math.max(roundingOre, 0);
  const creditOre =
    lines.reduce((sum, l) => sum + l.credit, 0) + totalOre + Math.max(-roundingOre, 0);
  const debit = debitOre / 100;
  const credit = creditOre / 100;
  const difference = (creditOre - debitOre) / 100;

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
  // Supplier details are the register's, not the invoice's, once one is picked.
  const ofSupplier = (key: "bankgiro" | "plusgiro") => (
    <SavedInput readOnly value={(supplier ? supplier[key] : invoice[key]) ?? ""} />
  );

  const sumMismatch = blocker === "supplierInvoice.allocationSumMismatch";

  return (
    <>
      <Card>
        {header}
        <div className="@container space-y-5 px-inset py-5">
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
              {/* Suppliers are added in Fortnox, not here. */}
              {!supplier && !suppliers.loading && invoice.supplierName && (
                <p className="mt-1.5 text-xs text-muted">
                  {t("supplierNotInRegister", { name: invoice.supplierName })}
                </p>
              )}
            </BookField>
            <BookField label={tFields("invoiceDate")}>
              <SavedInput
                type="date"
                value={invoice.invoiceDate}
                onSave={(v) => commit("invoiceDate", v)}
              />
            </BookField>
            <BookField label={tFields("dueDate")}>
              <SavedInput
                type="date"
                value={invoice.dueDate}
                onSave={(v) => commit("dueDate", v)}
              />
            </BookField>
            <BookField label={tFields("ocr")} className="col-span-2">
              {text("ocr")}
            </BookField>
            <BookField label={tFields("invoiceNumber")}>{text("invoiceNumber")}</BookField>
            <BookField label={tBook("total")}>
              <SavedInput
                amount
                value={sekToInput(invoice.amount)}
                onSave={(v) => commit("amount", v)}
              />
            </BookField>
            <BookField label={tVoucher("allCostCenter")} className="col-span-2">
              <VoucherCostCenterPicker rows={rows} onChange={setRows} costCenters={costCenters} />
            </BookField>
          </div>

          <details open className="group border-t border-border pt-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold">
              <IconChevronRight className="size-4 transition-transform group-open:rotate-90" />
              {tBook("more")}
            </summary>
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

        <div className="flex justify-end border-t border-border px-inset py-4">
          <BookField label={tBook("rounding")} className="w-40">
            <SavedInput
              value={invoice.rounding ? sekToInput(oreToSEK(roundingOre)) : ""}
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
            {/* Only the unit can change its split, which asks every signer again. */}
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
