"use client";

// The page around one invoice's workspace: its name as the title, the way back
// to the list it is worked from, and what happens when it is sent back to the
// Inkorg and there is no invoice left to show.
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useProgressRouter } from "@/components/shell/route-progress";
import { InvoiceWorkspace } from "../workspace";
import { useInvoiceTitle } from "../invoice-bits";
import type { WorkspaceData } from "../load";

export function InvoiceDetailClient({ data, backHref }: { data: WorkspaceData; backHref: string }) {
  const router = useProgressRouter();
  const title = useInvoiceTitle();
  return (
    <PageShell width="content" title={title(data.invoice)} back={backHref}>
      <InvoiceWorkspace
        {...data}
        // Every action refreshes the page in place, except sending it back to
        // the Inkorg, which leaves nothing to show: back to the list.
        onDone={(status) => (status === "RETURNED" ? router.push(backHref) : router.refresh())}
      />
    </PageShell>
  );
}

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
