"use client";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { useProgressRouter } from "@/components/shell/route-progress";
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
  const router = useProgressRouter();
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
      <BookPanel {...data} cover={cover} onDone={() => router.push(record)} />
      <Card>
        <Timeline invoice={invoice} />
      </Card>
    </PageShell>
  );
}
