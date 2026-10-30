"use client";

// The fördelning of a levfaktura, as the page around it is the utlägg's form:
// the invoice beside it in the document panel, one card of what the unit
// says about it, and the button that sends it. See page.tsx.
//
// Fördela and attestera are two acts, but the unit does both here. The unit
// proposes the split (which cost centre takes how much) and signs the rows it
// may sign as it sends it. Any other unit's rows wait for that unit, which
// signs on the record. With one cost centre of its own it is one press.
//
// Two ways in, one form (AllocateForm). The first fördelning is of a document
// in the unit's Inkorg, and is what makes it an invoice
// (../../inbox/[id]). After that it is an invoice whose split was reopened or
// sent back, fördelad again here.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput, Field, FieldGroup, Input } from "@/components/ui/field";
import { IconCheck } from "@/components/ui/icons";
import { AllocationEditor, makeRow, type AllocationRow } from "@/components/allocation-editor";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useMutation } from "@/components/shell/use-mutation";
import { useProgressRouter } from "@/components/shell/route-progress";
import { parseOre, parseSEK } from "@/lib/domain/money";
import type { KonteringRow } from "@/lib/api/schemas/supplier-invoice";
import { attestBlocker } from "@/lib/domain/supplier-invoice";
import { cn } from "@/lib/ui/utils";
import type { CostCenter } from "@/lib/domain/types";
import type { AttestReach } from "@/lib/data/supplier-invoices";
import { useInvoiceTitle } from "../../invoice-bits";
import {
  ActionBar,
  LABEL,
  ReturnedNotice,
  asInput,
  invoiceDocuments,
  useReturnToInbox,
  useTransition,
} from "../../invoice-shared";
import type { WorkspaceData } from "../../load";

export function InvoiceAllocateClient({
  data,
  defaults,
  fromScan,
}: {
  data: WorkspaceData;
  /** What the form opens on. See page.tsx. */
  defaults: AllocateDefaults;
  /** Which of them were read off the PDF, so the form can say to check them. */
  fromScan: { amount: boolean; dueDate: boolean };
}) {
  const { invoice, can, reach, costCenters } = data;
  const tAction = useTranslations("invoices.action");
  const tDetail = useTranslations("invoices.detail");
  const title = useInvoiceTitle();
  const router = useProgressRouter();
  const docs = useMutation();
  const record = `/invoices/${invoice.id}`;
  const tr = useTransition(invoice.id, () => router.push(record));
  const back = useReturnToInbox(invoice.id, () => router.push("/invoices"));

  // The unit's "Inte vår" and triage's "Tillbaka till inkorgen" are the same
  // act, named for who does it.
  const backLabel = can.canMove ? tAction("return") : tAction("decline");

  async function uploadDocument(file: File) {
    const form = new FormData();
    form.append("file", file);
    await docs.mutate(`/api/supplier-invoices/${invoice.id}/documents`, { body: form, key: "upload" });
  }

  return (
    <AllocateForm
      title={title(invoice)}
      subtitle={[invoice.description && invoice.reference, invoice.resultUnitName].filter(Boolean).join(" - ") || undefined}
      back={record}
      panel={
        <ReceiptPanelSource
          documents={invoiceDocuments(invoice)}
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
      }
      notice={<ReturnedNotice invoice={invoice} />}
      unitName={invoice.resultUnitName}
      initialRows={
        invoice.allocations.length > 0
          ? invoice.allocations.map((a) =>
              makeRow(
                a.costCenterCode,
                asInput(a.amount ?? (invoice.allocations.length === 1 ? defaults.amount : null)),
                a.comment ?? "",
              ),
            )
          : [makeRow(invoice.suggestedCostCenter ?? "", asInput(defaults.amount))]
      }
      defaults={defaults}
      fromScan={fromScan}
      mail={invoice.mail}
      costCenters={costCenters}
      reach={reach}
      documentCount={invoice.documents.length}
      decline={
        can.canReturnToInbox
          ? { label: backLabel, busy: back.busy, run: () => void back.run(backLabel) }
          : null
      }
      busy={tr.busy}
      pending={tr.pending === "attest"}
      onSubmit={(f) => void tr.run({ action: "attest", ...f })}
    />
  );
}

/** What the form opens on: the amount in kronor, the due date and the line. */
export interface AllocateDefaults {
  amount: number | null;
  dueDate: string;
  description: string;
}

/** What the form sends, whichever way it was reached. */
export interface AllocateSubmission {
  rows: KonteringRow[];
  amount: number; // öre
  dueDate: string;
  description: string | null;
}

/**
 * The fördelning itself: the amount, due date and line, the split, who signs
 * what, and the button that sends it. What it is a fördelning of (a document
 * or an invoice) is its caller's, which also says what sending it does.
 */
export function AllocateForm({
  title,
  subtitle,
  back,
  panel,
  notice,
  unitName,
  initialRows,
  defaults,
  fromScan,
  mail,
  costCenters,
  reach,
  documentCount,
  decline,
  busy,
  pending,
  onSubmit,
}: {
  title: string;
  subtitle?: string;
  back: string;
  /** The document panel's source, beside the form. */
  panel: ReactNode;
  /** Said above the form: why it came back, for one that did. */
  notice?: ReactNode;
  /** The unit it was given to, whose cost centres are offered first. */
  unitName: string | null;
  initialRows: AllocationRow[];
  defaults: AllocateDefaults;
  fromScan: { amount: boolean; dueDate: boolean };
  /** The mail it was forwarded in, for what the forwarder wrote. */
  mail: { fromName: string | null; fromAddress: string; note: string | null } | null;
  costCenters: CostCenter[];
  /** Who the viewer may attest for, so the button says what pressing it does. */
  reach: AttestReach;
  documentCount: number;
  /** "Inte vår", or triage taking it back, when the viewer may. */
  decline: { label: string; busy: boolean; run: () => void } | null;
  busy: boolean;
  pending: boolean;
  onSubmit: (f: AllocateSubmission) => void;
}) {
  const t = useTranslations("invoices.allocate");
  const tField = useTranslations("invoices.field");
  const tAction = useTranslations("invoices.action");
  const tAttest = useTranslations("invoices.attest");
  const tErr = useTranslations("errors");

  const [totalInput, setTotalInput] = useState(asInput(defaults.amount));
  const [dueDate, setDueDate] = useState(defaults.dueDate);
  const [description, setDescription] = useState(defaults.description);
  const total = totalInput.trim() ? parseSEK(totalInput) : null;
  const totalOre = total == null || !Number.isFinite(total) || total <= 0 ? null : Math.round(total * 100);

  const [rows, setRowsState] = useState<AllocationRow[]>(initialRows);
  // Stable, because the editor keeps a lone row's amount equal to the total
  // in an effect that depends on it.
  const setRows = useCallback((next: AllocationRow[]) => setRowsState(next), []);
  const split = rows.length > 1;

  const unitOf = useMemo(() => new Map(costCenters.map((c) => [c.code, c.resultUnit ?? null])), [costCenters]);
  const mayAttest = (code: string) => reach.all || reach.units.includes(unitOf.get(code) ?? "");

  // The unit's own cost centres first: that is nearly always the answer.
  const options = useMemo(() => {
    const own = (c: CostCenter) => (c.resultUnit && c.resultUnit === unitName ? 0 : 1);
    return [...costCenters].sort((a, b) => own(a) - own(b) || a.code.localeCompare(b.code));
  }, [costCenters, unitName]);

  const payload = rows
    .filter((r) => r.costCenterCode)
    .map((r) => ({
      costCenterCode: r.costCenterCode,
      amount: split && r.amount.trim() ? parseOre(r.amount) : null,
      comment: r.comment.trim() || null,
    }));
  const blocker =
    totalOre == null
      ? "supplierInvoice.noAmount"
      : !dueDate
        ? "supplierInvoice.noDueDate"
        : payload.length !== rows.length
          ? "supplierInvoice.noAllocations"
          : attestBlocker({
              documentCount,
              rows: payload.map((p) => ({ amount: p.amount })),
              invoiceAmount: totalOre,
            });

  // Who will sign what, once sent: the reader now, the rest asked. Only worth
  // saying when somebody else is in it.
  const picked = rows.filter((r) => r.costCenterCode);
  const others = [
    ...new Set(
      picked.filter((r) => !mayAttest(r.costCenterCode)).map((r) => unitOf.get(r.costCenterCode) ?? r.costCenterCode),
    ),
  ];
  const mineCount = picked.filter((r) => mayAttest(r.costCenterCode)).length;
  const label =
    others.length === 0 ? tAction("attest") : mineCount > 0 ? tAttest("attestAndSend") : tAction("sendForAttest");

  return (
    <PageShell width="content" title={title} subtitle={subtitle} back={back}>
      {panel}
      {notice}

      <Card>
        <section className="space-y-4 px-inset py-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={tField("amount")} hint={fromScan.amount ? t("fromScan") : undefined} requirement="required">
              <AmountInput suffix="kr" value={totalInput} onChange={setTotalInput} inputClassName="text-right" />
            </Field>
            <Field label={tField("dueDate")} hint={fromScan.dueDate ? t("fromScan") : undefined} requirement="required">
              <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          <Field label={tField("description")} hint={t("descriptionHint")}>
            <Input
              value={description}
              maxLength={200}
              placeholder={t("descriptionPlaceholder")}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          {mail?.note && (
            <blockquote className="whitespace-pre-line border-l-2 border-border pl-3 text-sm text-muted">
              <span className="font-medium text-foreground">{mail.fromName ?? mail.fromAddress}:</span> {mail.note}
            </blockquote>
          )}
        </section>

        <section className="border-t border-border px-inset py-5">
          <FieldGroup label={tAttest("distribution")}>
            <AllocationEditor costCenters={options} grossAmount={totalOre == null ? 0 : totalOre / 100} value={rows} onChange={setRows} />
          </FieldGroup>
        </section>

        {others.length > 0 && (
          <section className="border-t border-border px-inset py-4">
            <h3 className={cn(LABEL, "mb-2")}>{tAttest("signersTitle")}</h3>
            <ul className="space-y-1 text-sm">
              {mineCount > 0 && <li>{tAttest("signerYou")}</li>}
              {others.map((unit) => (
                <li key={unit} className="text-muted">
                  {tAttest("signerAsked", { unit })}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">{tAttest("signersHint")}</p>
          </section>
        )}

        <ActionBar>
          {decline ? (
            <Button variant="ghost" disabled={busy || decline.busy} onClick={decline.run}>
              {decline.label}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {blocker && <span className="text-xs text-muted">{tErr(blocker)}</span>}
            <Button
              disabled={Boolean(blocker) || busy}
              loading={pending}
              onClick={() =>
                onSubmit({
                  rows: payload,
                  amount: totalOre!,
                  dueDate,
                  description: description.trim() || null,
                })
              }
            >
              {others.length === 0 && <IconCheck className="size-4" />}
              {label}
            </Button>
          </div>
        </ActionBar>
      </Card>
    </PageShell>
  );
}
