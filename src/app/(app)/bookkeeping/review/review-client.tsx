"use client";

// Granska och bokför, one utlägg at a time.
//
// The receipt beside the kontering, read-only, and the three things a reviewer
// does with it: send it to Fortnox and move on, send it back to the kontering
// screen, or leave it for later. Bokföring cannot be undone (Fortnox has no
// delete for a voucher), which is why this is the only place it is done from.
//
// A failure stays on the utlägg it belongs to. The reviewer is not moved on
// past something that did not go through, with only a toast to say so.
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { useRole } from "@/components/shell/role-context";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import { useProgressRouter } from "@/components/shell/route-progress";
import { expenseDocuments } from "@/lib/expense/document-url";
import { expenseLabel } from "@/lib/domain/reference";
import { canUnexport } from "@/lib/domain/permissions";
import type { ReviewWarning } from "@/lib/domain/review";
import type { ReviewQueue } from "@/lib/data/review-queue";
import type { Expense, FortnoxStatus } from "@/lib/domain/types";
import {
  AllocationSection,
  ExpenseSummary,
  FactStrip,
  NotesSection,
  TimelineSection,
  VerificationSection,
} from "../../expenses/[id]/detail-sections";
import { useLiveBookkeeping } from "../use-live-bookkeeping";
import { ExportResolveDialog } from "../export-resolve-dialog";

export interface ReviewItem {
  expense: Expense;
  warnings: ReviewWarning[];
  /** This viewer konterade it, and the two-person rule says they may not
   *  bokföra it. Shown all the same, with the reason. */
  ownBooking: boolean;
  /** 1-based place in the viewer's queue, or null when it is not in it. */
  position: number | null;
  /** The utlägg after this one, or null when this is the last. */
  next: string | null;
}

const reviewHref = (id: string | null) => (id ? `/bookkeeping/review?id=${id}` : "/bookkeeping/review");

export default function ReviewClient({
  item,
  queue,
  fortnox,
}: {
  item: ReviewItem | null;
  queue: ReviewQueue;
  fortnox: FortnoxStatus;
}) {
  const t = useTranslations("bookkeeping.review");

  if (!item) {
    return (
      <PageShell title={t("title")} back="/bookkeeping" width="content">
        <EmptyState
          title={t("emptyTitle")}
          description={
            queue.waitingOnOthers > 0
              ? t("emptyWaitingOnOthers", { count: queue.waitingOnOthers })
              : t("emptyDescription")
          }
          action={<ButtonLink href="/bookkeeping">{t("toList")}</ButtonLink>}
        />
      </PageShell>
    );
  }
  return <Review item={item} queue={queue} fortnox={fortnox} />;
}

function Review({
  item,
  queue,
  fortnox,
}: {
  item: ReviewItem;
  queue: ReviewQueue;
  fortnox: FortnoxStatus;
}) {
  const t = useTranslations("bookkeeping.review");
  const tBookkeeping = useTranslations("bookkeeping");
  const tExpense = useTranslations("expenses.mutations");
  const tReceipt = useTranslations("receipt");
  const { expense, warnings, ownBooking, position, next } = item;
  const { user } = useRole();
  const router = useProgressRouter();
  const notify = useNotify();
  const live = useLiveBookkeeping();
  const { pending, mutate } = useMutation();
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const label = expenseLabel(expense);
  const documents = expenseDocuments(expense, `${tReceipt("alt")} - ${expense.title}`, {
    cover: tReceipt("coverLabel"),
    underlag: tReceipt("underlagLabel"),
  });

  // What stands between this utlägg and Fortnox, the first that applies. Each
  // is said in the notice at the top, so the dead button is never unexplained.
  const lock = live.exporting[expense.id];
  const blocker = ownBooking
    ? t("ownBooking")
    : !fortnox.connected
      ? tBookkeeping("connectFirst")
      : !fortnox.session
        ? tBookkeeping("loginFirst")
        : lock
          ? lock.lock === "exporting"
            ? tBookkeeping("exportingNow", { name: lock.by?.name ?? tBookkeeping("someone") })
            : tBookkeeping("exportUncertain", { name: lock.by?.name ?? tBookkeeping("someone") })
          : null;
  const busy = pending !== null;
  const editHref = `/expenses/${expense.id}/book?review=1`;

  const goTo = useCallback(
    (id: string | null) => {
      router.replace(reviewHref(id));
      // The same address again when this was the last one: replace alone would
      // not ask the server, and the page would keep showing what was just sent.
      if (!id) router.refresh();
    },
    [router],
  );

  const bokfor = useCallback(async () => {
    if (blocker || busy) return;
    setError(null);
    const data = await mutate<{ label: string; attachWarning: string | null }>(
      `/api/expenses/${expense.id}/export`,
      {
        key: "export",
        error: tBookkeeping("exportFailed", { id: label }),
        refresh: false,
        onError: setError,
      },
    );
    if (!data) {
      // Quite possibly somebody else's lock. Ask now, so the notice says so.
      live.refresh();
      return;
    }
    const done = tBookkeeping("exportDone", { id: label, label: data.label });
    if (data.attachWarning) {
      notify.info(`${done}. ${tExpense("export.attachWarning", { detail: data.attachWarning })}`);
    } else notify.success(`${done}.`);
    goTo(next);
  }, [blocker, busy, mutate, expense.id, tBookkeeping, label, live, notify, tExpense, goTo, next]);

  // Enter bokför, E opens the kontering, → skips. Not while typing, and not
  // when a button or link has focus: Enter already means that control there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, button, a, [contenteditable], [role=dialog]")) return;
      if (resolving) return;
      if (e.key === "Enter") {
        e.preventDefault();
        void bokfor();
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        router.push(editHref);
      } else if (e.key === "ArrowRight" && next) {
        e.preventDefault();
        goTo(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bokfor, router, editHref, next, goTo, resolving]);

  const mayResolve = canUnexport(user.capabilities) && lock?.lock === "uncertain";

  return (
    <PageShell
      width="content"
      title={t("title")}
      subtitle={
        position !== null
          ? t("position", { position, total: queue.ids.length, label })
          : label
      }
      back="/bookkeeping"
    >
      <ReceiptPanelSource documents={documents} />

      {blocker && (
        <Notice>
          <p>{blocker}</p>
          {mayResolve && (
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => setResolving(true)}>
              {tBookkeeping("resolveExport")}
            </Button>
          )}
        </Notice>
      )}
      {error && (
        <Notice tone="danger">
          <p>{error}</p>
        </Notice>
      )}
      {warnings.length > 0 && (
        <Notice>
          <p className="font-medium">{t("warningsTitle")}</p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{t(`warning.${w}`)}</li>
            ))}
          </ul>
        </Notice>
      )}

      <Card>
        <ExpenseSummary
          expense={expense}
          actions={
            <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">
              <Button
                onClick={bokfor}
                loading={pending === "export"}
                disabled={blocker !== null || busy}
                className="flex-1 sm:flex-none"
              >
                {next ? t("bokforNext") : t("bokfor")}
              </Button>
              <ButtonLink href={editHref} variant="secondary">
                {t("edit")}
              </ButtonLink>
              {next && (
                <Button variant="ghost" onClick={() => goTo(next)} disabled={busy}>
                  {t("skip")}
                </Button>
              )}
            </div>
          }
        />

        <FactStrip expense={expense} />
        <NotesSection expense={expense} />
        <AllocationSection allocations={expense.allocations} />
        {expense.verification && (
          <VerificationSection
            verification={expense.verification}
            expenseId={expense.id}
            revisions={expense.revisions}
            canEdit={false}
          />
        )}
        <TimelineSection revisions={expense.revisions} />
      </Card>

      <p className="text-center text-xs text-muted">{t("shortcuts")}</p>

      {resolving && (
        <ExportResolveDialog
          expenseId={expense.id}
          label={label}
          by={lock?.by?.name ?? null}
          onClose={() => setResolving(false)}
          onResolved={() => {
            setResolving(false);
            live.refresh();
            router.refresh();
          }}
        />
      )}
    </PageShell>
  );
}
