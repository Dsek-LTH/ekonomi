"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ButtonLink } from "@/components/ui/button";
import type { Column } from "@/components/ui/data-table";
import { Tooltip } from "@/components/ui/tooltip";
import { useRole } from "@/components/shell/role-context";
import { canBookkeep, canUnexport } from "@/lib/domain/permissions";
import { expenseLabel } from "@/lib/domain/reference";
import type { PresentUser } from "@/lib/domain/presence";
import type { ExportLockView } from "@/lib/domain/export-claim";
import type { Expense } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import { useLiveBookkeeping } from "./use-live-bookkeeping";
import { ExportResolveDialog } from "./export-resolve-dialog";

/**
 * The dot on a button's corner that says something is happening to this utlägg.
 * Amber and pulsing while it is under way (somebody booking it, an export in
 * flight). Red and still when it is stuck and waiting on a person.
 */
function CornerDot({ tone }: { tone: "warning" | "danger" }) {
  const fill = tone === "warning" ? "bg-warning" : "bg-danger";
  return (
    <span aria-hidden className="pointer-events-none absolute -right-1 -top-1 flex size-2.5">
      {tone === "warning" && (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:hidden",
            fill,
          )}
        />
      )}
      <span className={cn("relative inline-flex size-2.5 rounded-full ring-2 ring-surface", fill)} />
    </span>
  );
}

/**
 * The treasury's column on the section's utlägg: Bokför on an attested one,
 * the review on a konterat one, and the voucher once it is in Fortnox. It used
 * to be a list of its own under Bokföring, the same utlägg cut to the signed
 * ones. Now it is the Utlägg list on Alla, where stage is a tab like on every
 * other list, and this column is what bookkeeping adds to it.
 *
 * `enabled` false polls nothing and adds no column, for every other scope and
 * for readers who are not bookkeeping.
 */
export function useBookingColumn(enabled: boolean): {
  column: Column<Expense> | null;
  dialog: React.ReactNode;
} {
  const t = useTranslations("bookkeeping");
  const { list } = useFormat();
  const { user } = useRole();
  const live = useLiveBookkeeping(enabled);
  const bookings = live.booking;
  const [resolving, setResolving] = useState<Expense | null>(null);

  const bookingHint = (users: PresentUser[]) =>
    t("bookingNowTitle", { names: list(users.map((u) => u.name)) });
  // The lock's own words, for the tooltip and for a screen reader.
  const exportHint = (v: ExportLockView) => {
    const name = v.by?.name ?? t("someone");
    return v.lock === "exporting" ? t("exportingNow", { name }) : t("exportUncertain", { name });
  };
  // Looking into an export that ended without an answer is EXPORT_UNDO's, the
  // same authority as unexporting. See app/api/expenses/[id]/export/resolve.
  const mayResolve = canUnexport(user.capabilities);
  // A revisor reads the list too. The buttons into booking and the review are
  // not theirs; the row itself still opens the utlägg.
  const mayBook = canBookkeep(user.capabilities);

  if (!enabled) return { column: null, dialog: null };

  const column: Column<Expense> = {
    key: "actions",
    header: "",
    align: "right",
    mobile: "actions",
    cell: (e) => (
      <div className="relative">
        {mayBook && e.status === "APPROVED" && (
          // Somebody else has it open for booking. Said, not enforced: the
          // button stays a button, and the booking screen asks before saving
          // over a colleague. See lib/domain/presence.ts.
          <Tooltip label={bookings[e.id] ? bookingHint(bookings[e.id]) : null}>
            <ButtonLink href={`/expenses/${e.id}/book`} size="sm">
              {t("book")}
              {bookings[e.id] && <span className="sr-only">{bookingHint(bookings[e.id])}</span>}
            </ButtonLink>
            {bookings[e.id] && <CornerDot tone="warning" />}
          </Tooltip>
        )}
        {mayBook && e.status === "BOOKED" &&
          (() => {
            // Bokföring is done from the review, one utlägg at a time, and not
            // from here: this opens the review at this one. A lock left
            // uncertain is still resolved from here, since it is not bokföring
            // but finding out whether it already happened.
            const locked = live.exporting[e.id];
            if (locked?.lock === "uncertain" && mayResolve) {
              return (
                <Tooltip label={exportHint(locked)}>
                  <Button size="sm" variant="secondary" onClick={() => setResolving(e)}>
                    {t("resolveExport")}
                  </Button>
                  <CornerDot tone="danger" />
                </Tooltip>
              );
            }
            return (
              <Tooltip label={locked ? exportHint(locked) : null}>
                <ButtonLink href={`/expenses/review?id=${e.id}`} size="sm" variant="secondary">
                  {t("review.open")}
                  {locked && <span className="sr-only">{exportHint(locked)}</span>}
                </ButtonLink>
                {locked && <CornerDot tone={locked.lock === "exporting" ? "warning" : "danger"} />}
              </Tooltip>
            );
          })()}
        {e.status === "EXPORTED" && e.verification?.fortnoxLabel && (
          <span className="text-xs text-muted">{t("voucherLabel", { label: e.verification.fortnoxLabel })}</span>
        )}
      </div>
    ),
  };

  const dialog = resolving && (
    <ExportResolveDialog
      expenseId={resolving.id}
      label={expenseLabel(resolving)}
      by={live.exporting[resolving.id]?.by?.name ?? null}
      onClose={() => setResolving(null)}
      onResolved={() => {
        setResolving(null);
        live.refresh();
      }}
    />
  );

  return { column, dialog };
}
