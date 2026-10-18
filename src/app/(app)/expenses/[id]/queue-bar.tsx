"use client";

// The way on to the next utlägg, for somebody working through a queue.
//
// Attesting or booking used to end on the utlägg just handled, and the next one
// was a trip back to the list and a click on its top row, every time. This is
// that top row, offered here. It shows only when the utlägg was opened from
// the queue's own page (see carriedSection in lib/ui/routes.ts): opened from
// your own list, or from a link, an utlägg is not part of a round.
//
// Two states. While this one still waits on you, the bar is quiet and lets you
// skip it. Once it does not, because you just attested or booked it, the bar
// says so and the next one is the main button.
import { useTranslations } from "next-intl";
import { ButtonLink } from "@/components/ui/button";
import { IconCheck, IconChevronRight } from "@/components/ui/icons";
import { useActiveSection } from "@/components/shell/section-nav";
import type { ExpenseQueue, QueueNext } from "@/lib/data/expense-queue";
import { cn } from "@/lib/ui/utils";

const QUEUE_OF: Record<string, ExpenseQueue> = {
  "/approvals": "approvals",
  "/bookkeeping": "bookkeeping",
};

export function QueueBar({
  queues,
  waiting,
}: {
  queues: Partial<Record<ExpenseQueue, QueueNext>>;
  /** Whether this utlägg still waits on the viewer, per queue. */
  waiting: Record<ExpenseQueue, boolean>;
}) {
  const t = useTranslations("expenses.detail.queue");
  const section = useActiveSection();
  const queue = section ? QUEUE_OF[section] : undefined;
  const state = queue ? queues[queue] : undefined;
  if (!queue || !state) return null;

  const done = !waiting[queue];
  const { next, remaining } = state;
  // Nothing to skip to, and nothing finished to say so about.
  if (!done && !next) return null;

  const name = next ? (next.reference ? `${next.reference} – ${next.title}` : next.title) : "";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border px-inset py-3",
        done ? "border-accent/30 bg-accent-soft/40" : "border-border bg-surface/60",
      )}
    >
      <p className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        {done && <IconCheck className="size-4 shrink-0 text-accent" />}
        <span className={cn(!done && "text-muted")}>
          {done
            ? next
              ? t(`${queue}.done`, { count: remaining })
              : t(`${queue}.empty`)
            : t(`${queue}.waiting`, { count: remaining })}
        </span>
      </p>
      {next ? (
        // Replacing, so Back from the next one goes to the list rather than
        // through every utlägg already handled.
        <ButtonLink
          href={`/expenses/${next.id}`}
          replace
          size="sm"
          variant={done ? "primary" : "ghost"}
          className="max-w-full"
        >
          <span className="truncate">
            {done ? t("next", { name }) : t("skip")}
          </span>
          <IconChevronRight className="size-4 shrink-0" />
        </ButtonLink>
      ) : (
        <ButtonLink href={`/${queue}`} size="sm" variant="secondary">
          {t(`${queue}.toList`)}
        </ButtonLink>
      )}
    </div>
  );
}
