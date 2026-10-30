"use client";

// The fördelning of a document in the unit's Inkorg, which makes it an
// invoice. The form is the invoice's own (AllocateForm). What is different is
// what sending it does: it makes the invoice, and the reader goes on to it.
import { useTranslations } from "next-intl";
import { makeRow } from "@/components/allocation-editor";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { Notice } from "@/components/ui/notice";
import { useConfirm } from "@/components/confirm-dialog";
import { useMutation } from "@/components/shell/use-mutation";
import { useProgressRouter } from "@/components/shell/route-progress";
import type { CostCenter } from "@/lib/domain/types";
import type { AttestReach } from "@/lib/data/supplier-invoices";
import type { InboxDocument } from "@/lib/data/invoice-inbox";
import { asInput } from "../../invoice-shared";
import { AllocateForm, type AllocateDefaults } from "../../[id]/allocate/allocate-client";

export function DocumentAllocateClient({
  document: d,
  title,
  suggestedCostCenter,
  costCenters,
  reach,
  defaults,
  fromScan,
}: {
  document: InboxDocument;
  title: string;
  suggestedCostCenter: string | null;
  costCenters: CostCenter[];
  reach: AttestReach;
  defaults: AllocateDefaults;
  fromScan: { amount: boolean; dueDate: boolean };
}) {
  const t = useTranslations("invoices.inkorg");
  const tAction = useTranslations("invoices.action");
  const router = useProgressRouter();
  const confirm = useConfirm();
  const create = useMutation();
  const decliner = useMutation();

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
    if (res) router.push("/invoices/inbox");
  }

  return (
    <AllocateForm
      title={title}
      subtitle={d.resultUnitName ?? undefined}
      back={`/invoices/inbox?doc=${d.id}`}
      panel={
        <ReceiptPanelSource
          documents={[{ src: `/api/supplier-invoice-documents/${d.id}`, mimeType: d.mimeType, filename: d.filename }]}
        />
      }
      notice={
        d.returned && (
          <Notice tone="warning">
            <p>{t("returned", { unit: d.returned.from ?? "-", reason: d.returned.reason })}</p>
          </Notice>
        )
      }
      unitName={d.resultUnitName}
      initialRows={[makeRow(suggestedCostCenter ?? "", asInput(defaults.amount))]}
      defaults={defaults}
      fromScan={fromScan}
      mail={d.note ? { fromName: d.fromName, fromAddress: d.fromAddress ?? "", note: d.note } : null}
      costCenters={costCenters}
      reach={reach}
      documentCount={1}
      decline={d.can.canDecline ? { label: t("decline"), busy: decliner.busy, run: () => void decline() } : null}
      busy={create.busy || decliner.busy}
      pending={create.busy}
      onSubmit={async (f) => {
        const res = await create.mutate<{ id: string }>("/api/supplier-invoices", {
          body: { documentId: d.id, ...f },
          success: tAction("done.attest"),
          refresh: false,
        });
        if (res) router.push(`/invoices/${res.id}`);
      }}
    />
  );
}
