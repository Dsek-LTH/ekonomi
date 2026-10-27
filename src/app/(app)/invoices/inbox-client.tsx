"use client";

// The treasury's inbox: every open invoice down the left, by what it needs,
// and the selected one beside it.
//
// Built like a mail client because the job is the same: a stream of items,
// each needing a decision and a look at a document. The list is sections
// rather than tabs, so the whole pipeline is in view at once, and each section
// is in due-date order, because an invoice paid late costs the section money.
// Doing what the selected one needs opens the next, and j/k step through them
// without the mouse.
//
// Below lg there is no room for both, so the list is the page and an opened
// invoice replaces it, with a way back.
import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconUpload } from "@/components/ui/icons";
import { useMutation } from "@/components/shell/use-mutation";
import { useProgressRouter } from "@/components/shell/route-progress";
import { formatSEK } from "@/lib/ui/format";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import type { InboxHealth, SupplierInvoiceRow } from "@/lib/data/supplier-invoices";
import { DueLabel, useInvoiceTitle } from "./invoice-bits";
import { InvoiceWorkspace } from "./workspace";
import { SECTIONS, nextAfter, orderedQueue } from "./queue";
import type { WorkspaceData } from "./load";

export function InboxClient({
  rows,
  selected,
  explicit,
  canUpload,
  health,
}: {
  rows: SupplierInvoiceRow[];
  /** The invoice beside the list, or null with nothing open. */
  selected: WorkspaceData | null;
  /** Whether it was asked for by the URL, rather than picked as the first to
   *  do. On a phone only an asked-for invoice replaces the list. */
  explicit: boolean;
  canUpload: boolean;
  /** The mailbox's state. Null for anyone but triage. */
  health: InboxHealth | null;
}) {
  const t = useTranslations("invoices");
  const router = useProgressRouter();
  const queue = useMemo(() => orderedQueue(rows), [rows]);
  const selectedId = selected?.invoice.id ?? null;

  const open = useCallback((id: string | null) => {
    router.push(id ? `/invoices?id=${id}` : "/invoices", { scroll: false });
  }, [router]);

  // j and k, as in every mail client since Gmail. Not while typing, and not
  // with a modifier held, which is somebody else's shortcut.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      if (e.key !== "j" && e.key !== "k") return;
      const i = queue.findIndex((r) => r.id === selectedId);
      const next = e.key === "j" ? queue[i + 1] : queue[i - 1];
      if (next) {
        e.preventDefault();
        open(next.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queue, selectedId, open]);

  const upload = canUpload ? <UploadButton /> : null;

  if (queue.length === 0 && !selected) {
    return (
      <PageShell title={t("title")} aside={<ArchiveLink />}>
        <EmptyState
          title={t("inbox.emptyTitle")}
          description={canUpload ? t("emptyTriage") : t("inbox.emptyDescription")}
          action={upload ?? undefined}
        />
        {health?.enabled && <MailboxCard health={health} />}
      </PageShell>
    );
  }

  return (
    <PageShell title={t("title")} width="wide" aside={<ArchiveLink />}>
      <div className="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className={cn("space-y-4", explicit && "hidden lg:block")}>
          {upload && <div className="flex justify-end">{upload}</div>}
          <QueueList queue={queue} selectedId={selectedId} onOpen={open} />
          {health?.enabled && <MailboxCard health={health} />}
        </div>

        <div className={cn(!explicit && "hidden lg:block")}>
          {explicit && (
            <Link href="/invoices" className="mb-3 inline-block text-sm text-accent hover:underline lg:hidden">
              {t("inbox.backToList")}
            </Link>
          )}
          {selected ? (
            <InvoiceWorkspace
              // Remounted per invoice, so a half-done kontering on one never
              // shows up on the next.
              key={selected.invoice.id}
              {...selected}
              onDone={() => open(nextAfter(queue, selected.invoice.id))}
            />
          ) : (
            <p className="text-sm text-muted">{t("inbox.nothingOpen")}</p>
          )}
        </div>
      </div>
    </PageShell>
  );
}

function ArchiveLink() {
  const t = useTranslations("invoices");
  return (
    <ButtonLink href="/invoices/arkiv" variant="secondary" size="sm">
      {t("archive.link")}
    </ButtonLink>
  );
}

/** The list, by section, each with its count. A section with nothing in it is
 *  left out rather than drawn empty. */
function QueueList({
  queue,
  selectedId,
  onOpen,
}: {
  queue: SupplierInvoiceRow[];
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("invoices.inbox");
  const title = useInvoiceTitle();
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Keep the selected row in view when j/k walks past the fold.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <Card>
      <nav aria-label={t("listLabel")} className="divide-y divide-border">
        {SECTIONS.map((section) => {
          const items = queue.filter((r) => r.queue === section);
          if (items.length === 0) return null;
          return (
            <section key={section} className="py-2">
              <h2 className="flex items-baseline justify-between px-inset pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <span>{t(`section.${section}`)}</span>
                <span className="tabular-nums">{items.length}</span>
              </h2>
              <ul>
                {items.map((r) => {
                  const active = r.id === selectedId;
                  return (
                    <li key={r.id}>
                      <button
                        ref={active ? selectedRef : undefined}
                        type="button"
                        aria-current={active ? "true" : undefined}
                        onClick={() => onOpen(r.id)}
                        className={cn(
                          "block w-full px-inset py-2 text-left transition-colors hover:bg-hover",
                          active && "bg-accent-soft hover:bg-accent-soft",
                        )}
                      >
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-sm font-medium">{title(r)}</span>
                          <span className="shrink-0 text-sm tabular-nums">
                            {r.amount == null ? "" : formatSEK(r.amount)}
                          </span>
                        </span>
                        <span className="mt-0.5 flex items-baseline justify-between gap-3 text-xs">
                          <span className="min-w-0 truncate text-muted">
                            {r.resultUnitName ?? (r.receivedByName ? t("via", { name: r.receivedByName }) : "")}
                          </span>
                          <DueLabel dueDate={r.dueDate} className="shrink-0" />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </nav>
    </Card>
  );
}

/** Putting a PDF in by hand. Opens the new invoice straight away: one with
 *  nothing on it yet is not worth finding in a list. */
function UploadButton() {
  const t = useTranslations("invoices");
  const router = useProgressRouter();
  const upload = useMutation();
  const picker = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    const form = new FormData();
    form.append("file", file);
    const created = await upload.mutate<{ id: string }>("/api/supplier-invoices", { body: form, refresh: false });
    if (created) router.push(`/invoices?id=${created.id}`);
  }

  return (
    <>
      <input
        ref={picker}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void onFile(file);
        }}
      />
      <Button size="sm" variant="accentOutline" loading={upload.busy} onClick={() => picker.current?.click()}>
        <IconUpload className="size-4" />
        {t("upload")}
      </Button>
    </>
  );
}

/**
 * The inkorg mailbox: when it was last read, the error if the last read
 * failed, and the mail it refused lately. A forward that "never arrived" is
 * usually here, refused for coming from a private address.
 */
function MailboxCard({ health }: { health: InboxHealth }) {
  const t = useTranslations("invoices.mailbox");
  const { dateTime } = useFormat();
  return (
    <Card>
      <div className="space-y-2 px-inset py-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t("title")}</h2>
          <span className="text-xs text-muted">
            {health.lastSyncAt ? t("lastSync", { when: dateTime(health.lastSyncAt) }) : t("neverSynced")}
          </span>
        </div>
        {health.lastError && <p className="text-danger">{t("error", { error: health.lastError })}</p>}
        {health.rejected.length === 0 ? (
          <p className="text-xs text-muted">{t("noneRejected")}</p>
        ) : (
          <>
            <p className="text-xs text-muted">{t("rejectedLead")}</p>
            <ul className="divide-y divide-border">
              {health.rejected.map((r) => (
                <li key={r.id} className="py-1.5 text-xs">
                  <span className="block truncate">
                    {r.fromAddress || t("unknownSender")}
                    {r.subject && <span className="text-muted"> - {r.subject}</span>}
                  </span>
                  <span className="text-muted">
                    {r.reason ? t(`reason.${r.reason}`) : ""} - {dateTime(r.receivedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
