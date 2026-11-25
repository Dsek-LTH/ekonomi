"use client";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { useGoUp } from "@/components/shell/route-history";
import { BookPanel } from "../../book-view";
import { useInvoiceTitle } from "../../invoice-bits";
import { Timeline } from "../../invoice-shared";
import type { CoverFacts } from "@/lib/ui/invoice-cover";
import type { WorkspaceData } from "../../load";

export function InvoiceBookClient({
  data,
  cover,
}: {
  data: WorkspaceData;
  cover: CoverFacts | null;
}) {
  const { invoice } = data;
  const goUp = useGoUp();
  const title = useInvoiceTitle();
  const record = `/invoices/${invoice.id}`;
  return (
    <PageShell
      width="content"
      title={title(invoice)}
      subtitle={
        [invoice.description && invoice.reference, invoice.resultUnitName]
          .filter(Boolean)
          .join(" - ") || undefined
      }
      back={record}
    >
      <BookPanel {...data} cover={cover} onDone={() => goUp(record)} />
      <Card>
        <Timeline invoice={invoice} />
      </Card>
    </PageShell>
  );
}
