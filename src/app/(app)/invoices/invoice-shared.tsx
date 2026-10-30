"use client";

// What the pages of a levfaktura share: the record ([id]/record-client), the
// fördelning ([id]/allocate) and the kontering (./book-view). The props they
// are given, the actions they take, the documents beside them and the history.
import { useTranslations } from "next-intl";
import { Notice } from "@/components/ui/notice";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { commaForm } from "@/lib/domain/money";
import type { InvoiceCapabilities } from "@/lib/domain/supplier-invoice";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import type { TransitionSupplierInvoice } from "@/lib/api/schemas/supplier-invoice";
import type { AccountRecord, CostCenter, ProjectRecord, SupplierInvoiceStatus } from "@/lib/domain/types";
import type { AttestReach, SupplierInvoiceView } from "@/lib/data/supplier-invoices";

/** The small capitals every label on the card is set in, as on the utlägg page. */
export const LABEL = "text-xs font-medium text-muted";

/** The bar along the card's foot, held at the bottom of the screen. */
export function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-b-panel border-t border-border bg-background px-inset py-3">
      {children}
    </div>
  );
}

/** The invoice's documents, for the document panel beside its pages. */
export const invoiceDocuments = (invoice: SupplierInvoiceView) =>
  invoice.documents.map((d) => ({
    src: `/api/supplier-invoice-documents/${d.id}`,
    mimeType: d.mimeType,
    filename: d.filename,
    label: invoice.documents.length > 1 ? d.filename : undefined,
  }));

/** An amount in kronor as the amount field writes one. */
export const asInput = (sek: number | null) =>
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
  /** Fortnox's projects, for the kontering. Empty for anyone else. */
  projects: ProjectRecord[];
  resultUnits: { id: string; name: string }[];
  /**
   * Called after an action, with the status it left the invoice in, or
   * RETURNED when it went back to the Inkorg and there is no invoice left.
   * Without it the page refreshes in place, which is wrong only for that.
   */
  onDone?: (status: SupplierInvoiceStatus | "RETURNED") => void;
}

/** The comment it was sent back with, where the person it went back to looks
 *  first. */
export function ReturnedNotice({ invoice }: { invoice: SupplierInvoiceView }) {
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

// ── Actions ───────────────────────────────────────────────────────

export function useTransition(invoiceId: string, onDone?: WorkspaceProps["onDone"]) {
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

/**
 * Sending the invoice back to the Inkorg, with the reason asked for first. It
 * stops being an invoice (see the return route), so the page it was on has
 * nothing left to show, which onDone answers.
 */
export function useReturnToInbox(invoiceId: string, onDone?: WorkspaceProps["onDone"]) {
  const tAction = useTranslations("invoices.action");
  const confirm = useConfirm();
  const m = useMutation();
  async function run(title: string) {
    const ok = await confirm({
      title,
      message: tAction("confirm.return"),
      confirmLabel: title,
      comment: { label: tAction("returnLabel"), required: true },
    });
    if (!ok) return;
    const res = await m.mutate(`/api/supplier-invoices/${invoiceId}/return`, {
      body: { reason: ok.comment },
      success: tAction("done.return"),
      refresh: !onDone,
    });
    if (res && onDone) onDone("RETURNED");
  }
  return { run, busy: m.busy };
}

// As an utlägg's history colours them (expenses/[id]/detail-sections.tsx).
const EVENT_TONE: Partial<Record<SupplierInvoiceView["events"][number]["type"], string>> = {
  APPROVED: "text-blue",
  COST_CENTER_APPROVED: "text-blue",
  EXPORTED: "text-success",
  CHANGES_REQUESTED: "text-danger",
};

export function Timeline({ invoice }: { invoice: SupplierInvoiceView }) {
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
