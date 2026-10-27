"use client";

// The resultatansvarig's view: what they have to attest, one at a time.
//
// They usually have one or two, arriving now and then by mail, so a list to
// pick from would be a step in the way. The page opens on the first, PDF beside
// it and the one question in front, and attesting it opens the next. "1 av 3"
// says how many are left, and is the only navigation there is.
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useProgressRouter } from "@/components/shell/route-progress";
import type { SupplierInvoiceRow } from "@/lib/data/supplier-invoices";
import { InvoiceWorkspace } from "./workspace";
import { nextAfter } from "./queue";
import type { WorkspaceData } from "./load";

export function FocusClient({
  queue,
  current,
}: {
  /** What waits on the viewer, in order. */
  queue: SupplierInvoiceRow[];
  /** The invoice on screen, which may be one that is not in the queue (opened
   *  from a mail after it was dealt with). Null with nothing to show. */
  current: WorkspaceData | null;
}) {
  const t = useTranslations("invoices");
  const router = useProgressRouter();

  if (!current) {
    return (
      <PageShell title={t("title")}>
        <EmptyState
          title={t("focus.emptyTitle")}
          description={t("focus.emptyDescription")}
          action={
            <ButtonLink href="/invoices/arkiv" variant="secondary">
              {t("archive.link")}
            </ButtonLink>
          }
        />
      </PageShell>
    );
  }

  const id = current.invoice.id;
  const i = queue.findIndex((r) => r.id === id);
  const at = (n: number) => queue[n] && `/invoices?id=${queue[n].id}`;

  const header =
    i >= 0 && queue.length > 1 ? (
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">{t("focus.position", { n: i + 1, total: queue.length })}</span>
        <span className="flex gap-4">
          {at(i - 1) && (
            <Link href={at(i - 1)!} className="text-accent hover:underline">
              {t("focus.previous")}
            </Link>
          )}
          {at(i + 1) && (
            <Link href={at(i + 1)!} className="text-accent hover:underline">
              {t("focus.next")}
            </Link>
          )}
        </span>
      </div>
    ) : null;

  return (
    <PageShell title={t("title")} width="content" aside={<ButtonLink href="/invoices/arkiv" variant="secondary" size="sm">{t("archive.link")}</ButtonLink>}>
      <InvoiceWorkspace
        key={id}
        {...current}
        header={header}
        onDone={() => {
          const next = nextAfter(queue, id);
          router.push(next ? `/invoices?id=${next}` : "/invoices", { scroll: false });
        }}
      />
    </PageShell>
  );
}
