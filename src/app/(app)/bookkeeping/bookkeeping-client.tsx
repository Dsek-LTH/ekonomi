"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { useUrlTableControls } from "@/lib/data/use-list-query";
import { DataTable, type Column, type TabFilter } from "@/components/ui/data-table";
import {
  expenseAmountColumn,
  expenseDateColumn,
  expensePaymentTypeColumn,
  expenseReferenceColumn,
  expenseStatusColumn,
  expenseSubmitterColumn,
  expenseTitleColumn,
} from "@/components/columns/expense-columns";
import { expenseLabel } from "@/lib/domain/reference";
import { useMutation } from "@/components/shell/use-mutation";
import { useNotify } from "@/components/shell/notifications";
import type { RowPage } from "@/lib/data/list-query";
import type { Expense, FortnoxStatus } from "@/lib/domain/types";
import { useFormat } from "@/lib/ui/use-format";
import type { PresentUser } from "@/lib/domain/presence";
import type { ExportLockView } from "@/lib/domain/export-claim";
import { canUnexport } from "@/lib/domain/permissions";
import { useRole } from "@/components/shell/role-context";
import { Tooltip } from "@/components/ui/tooltip";
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

export default function BookkeepingClient({
  page,
  fortnox,
}: {
  page: RowPage<Expense>;
  fortnox: FortnoxStatus;
}) {
  const notify = useNotify();
  const t = useTranslations("bookkeeping");
  const tCol = useTranslations("expenses.col");
  const tList = useTranslations("expenses");
  const tExpense = useTranslations("expenses.mutations");
  const tPayment = useTranslations("common.payment");
  const { date, list } = useFormat();
  const { user } = useRole();
  const live = useLiveBookkeeping();
  const bookings = live.booking;
  const bookingHint = (users: PresentUser[]) =>
    t("bookingNowTitle", { names: list(users.map((u) => u.name)) });
  // The lock's own words, for the tooltip and for a screen reader.
  const exportHint = (v: ExportLockView) => {
    const name = v.by?.name ?? t("someone");
    return v.lock === "exporting"
      ? t("exportingNow", { name })
      : t("exportUncertain", { name });
  };
  // Looking into an export that ended without an answer is EXPORT_UNDO's, the
  // same authority as unexporting. See app/api/expenses/[id]/export/resolve.
  const mayResolve = canUnexport(user.capabilities);
  const [resolving, setResolving] = useState<Expense | null>(null);
  const controls = useUrlTableControls(page.total);
  const { pending, mutate } = useMutation();

  // No predicates: the tab value is a status the server filters on, and the
  // page arrives already narrowed to it. "Bokföring picks up where approval
  // ends" (approved, booked, exported) is likewise the page's query now
  // (ExpenseListScope "signed"), not a filter applied to everything.
  const tabs: TabFilter = [
    { value: "all", label: t("tab.all") },
    { value: "APPROVED", label: t("tab.toBook") },
    { value: "BOOKED", label: t("tab.toExport") },
    { value: "EXPORTED", label: t("tab.exported") },
  ];
  // The OAuth round-trip's result is surfaced globally, see FortnoxAuthResult
  // in the app layout, since the callback can return to any page.

  // Keyed on the utlägg's id, spoken about by its reference. Anything
  // exportable has been through attest, so it has one.
  async function doExport(expense: Expense) {
    const id = expense.id;
    const name = expenseLabel(expense);
    const data = await mutate<{
      label: string;
      attachWarning: string | null;
      coverWarning: string | null;
    }>(`/api/expenses/${id}/export`, {
      key: id,
      error: t("exportFailed", { id: name }),
    });
    if (!data) {
      // Very likely refused because somebody else holds the lock. Ask now, so
      // the button shows why instead of waiting for the next poll.
      live.refresh();
      return;
    }
    const done = t("exportDone", { id: name, label: data.label });
    // The warning describes itself, so it's passed through verbatim.
    if (data.attachWarning) {
      notify.info(`${done}. ${tExpense("export.attachWarning", { detail: data.attachWarning })}`);
    }
    else notify.success(`${done}.`);
  }

  // The voucher is written under the bookkeeper's own Fortnox login, so an
  // export needs both the org's connection and a live personal session. Without
  // either the button stays visible but inert, and says which one is missing.
  const exportBlocked = !fortnox.connected
    ? t("connectFirst")
    : !fortnox.session
      ? t("loginFirst")
      : null;

  const columns: Column<Expense>[] = [
    expenseReferenceColumn(tCol("verification")),
    expenseTitleColumn(tCol("title"), { reference: false }),
    expenseDateColumn(tCol("date"), date),
    expensePaymentTypeColumn(tCol("type"), (type) => tPayment(`${type}.label`)),
    expenseSubmitterColumn(tCol("submitter")),
    expenseAmountColumn(tCol("amount")),
    expenseStatusColumn(tCol("status")),
    {
      key: "actions",
      header: "",
      align: "right",
      mobile: "actions",
      cell: (e) => (
        <div className="relative">
          {e.status === "APPROVED" && (
            // Somebody else has it open for booking. Said, not enforced: the
            // button stays a button, and the booking screen asks before saving
            // over a colleague. See lib/domain/presence.ts.
            //
            // A dot on the button's corner, and who it is on hover. The Tooltip
            // is also what the dot is placed against.
            <Tooltip label={bookings[e.id] ? bookingHint(bookings[e.id]) : null}>
              <ButtonLink href={`/expenses/${e.id}/book`} size="sm">
                {t("book")}
                {bookings[e.id] && <span className="sr-only">{bookingHint(bookings[e.id])}</span>}
              </ButtonLink>
              {bookings[e.id] && <CornerDot tone="warning" />}
            </Tooltip>
          )}
          {e.status === "BOOKED" &&
            (() => {
              // Locked by an export, its own or anybody's. Not advisory like
              // the booking dot: the server refuses a second export while the
              // lock is held, so the button is dead to match. A disabled
              // control takes no pointer events, which is why the hint hangs
              // on the wrapper.
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
              const blocked = locked ? exportHint(locked) : exportBlocked;
              return (
                <Tooltip label={blocked}>
                  <Button
                    size="sm"
                    loading={pending === e.id}
                    disabled={blocked !== null}
                    aria-label={blocked ?? undefined}
                    onClick={() => doExport(e)}
                  >
                    {t("export")}
                  </Button>
                  {locked && <CornerDot tone={locked.lock === "exporting" ? "warning" : "danger"} />}
                </Tooltip>
              );
            })()}
          {e.status === "EXPORTED" && e.verification?.fortnoxLabel && (
            <span className="text-xs text-muted">{t("voucherLabel", { label: e.verification.fortnoxLabel })}</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <PageShell
      title={t("title")}
    >
      <Card>
        <DataTable
          columns={columns}
          rows={page.rows}
          controls={controls}
          tabs={tabs}
          rowKey={(e) => e.id}
          rowHref={(e) => `/expenses/${e.id}`}
          empty={tList("noMatch")}
        />
      </Card>
      {resolving && (
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
      )}
    </PageShell>
  );
}
