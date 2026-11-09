"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { MatchHelp, TransactionPicker } from "@/components/transaction-picker";
import { expenseDocuments } from "@/lib/expense/document-url";
import { Amount } from "@/components/ui/amount";
import { PaymentIcon } from "@/components/ui/payment-tag";
import { cardMask } from "@/components/columns/bank-columns";
import { matchCandidates } from "@/lib/domain/matching";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
import type { BankTransaction, Expense, FortnoxStatus } from "@/lib/domain/types";
import {
  AllocationSection,
  ExpenseSummary,
  FactStrip,
  NotesSection,
  TimelineSection,
  VerificationSection,
} from "./detail-sections";
import { InspectorSection, LABEL } from "@/components/record-card";
import { ExpenseActionNotice, ExpenseActions } from "./expense-actions";
import { ReminderDialog } from "@/components/reminder-dialog";
import type { ExpenseCapabilities } from "@/lib/domain/expense-capabilities";
import { useExpenseMutations } from "./use-expense-mutations";
import { Notice } from "@/components/ui/notice";
import { expenseLabel } from "@/lib/domain/reference";
import type { ReviewWarning } from "@/lib/domain/review";
import { useLiveBookkeeping } from "../use-live-bookkeeping";
import { useBookingPresence } from "./book/use-booking-presence";
import { useConfirm } from "@/components/confirm-dialog";
import { PersonName } from "@/components/ui/avatar";

/** What bokföring needs to know, worked out on the server (bookkeepingReview in page.tsx). */
export interface BookkeepingReview {
  warnings: ReviewWarning[];
  /** Konterat by the reader, so the two-person rule gives it to somebody else. */
  ownBooking: boolean;
}

export default function ExpenseDetailClient({
  expense,
  can,
  bankTransactions,
  fortnox,
  review,
}: {
  expense: Expense | null;
  // Null exactly when `expense` is: there is nothing to be capable of. The two
  // are narrowed together below so the detail view sees both as present.
  can: ExpenseCapabilities | null;
  bankTransactions: BankTransaction[];
  fortnox: FortnoxStatus;
  review: BookkeepingReview | null;
}) {
  if (!expense || !can) {
    return <ExpenseMissing />;
  }
  return (
    <ExpenseDetail
      expense={expense}
      can={can}
      bankTransactions={bankTransactions}
      fortnox={fortnox}
      review={review}
    />
  );
}

function ExpenseMissing() {
  const t = useTranslations("expenses.detail");
  return (
    <EmptyState
      title={t("missingTitle")}
      description={t("missingDescription")}
      action={<ButtonLink href="/expenses">{t("missingAction")}</ButtonLink>}
    />
  );
}

function ExpenseDetail({
  expense,
  can,
  bankTransactions,
  fortnox,
  review,
}: {
  expense: Expense;
  /** Decided on the server. See expenseCapabilities. */
  can: ExpenseCapabilities;
  bankTransactions: BankTransaction[];
  fortnox: FortnoxStatus;
  review: BookkeepingReview | null;
}) {
  const t = useTranslations("expenses.detail");
  const tBookkeeping = useTranslations("bookkeeping");
  const tReceipt = useTranslations("receipt");
  const mutations = useExpenseMutations(expense.id);
  const [reminding, setReminding] = useState(false);
  // How many rows the viewer could sign now. With more than one, the header's
  // button says it signs them all.
  const attestable =
    expense.status === "PENDING_APPROVAL"
      ? expense.allocations.filter((a) => a.canAttest && !a.approvedById).length
      : 0;
  // Attest and its withdrawal on each row, wherever there is more than one
  // cost centre to tell apart. With one, the header's buttons are the same act.
  const perRow = expense.allocations.length > 1;
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  async function onRow(id: string, act: () => Promise<unknown>) {
    setRowBusy(id);
    await act();
    setRowBusy(null);
  }
  const documents = expenseDocuments(expense, `${tReceipt("alt")} - ${expense.title}`, {
    cover: tReceipt("coverLabel"),
    underlag: tReceipt("underlagLabel"),
  });
  const matched = bankTransactions.find((t) => t.id === expense.matchedTransactionId);

  // Somebody else sending it to Fortnox right now, or an export that ended
  // without an answer: either way not one to send again from here. Asked only
  // where it could be sent.
  const live = useLiveBookkeeping(can.canExport);
  const { list } = useFormat();
  const confirm = useConfirm();
  // Who else granskar this konterat utlägg. Announced only by someone who could bokföra it from here.
  // Advisory: the export lock stops a second export.
  const reviewers = useBookingPresence(
    can.canExport && !review?.ownBooking ? expense.id : null,
    null,
    "review",
  ).others;
  const reviewerNames = list(reviewers.map((r) => r.name));
  const lock = live.exporting[expense.id];
  const lockedBy = lock?.by?.name ?? tBookkeeping("someone");
  // Why it cannot be bokförd by this reader, besides Fortnox (which the
  // actions work out themselves). Said on the dead button, on hover.
  const exportBlock = review?.ownBooking
    ? tBookkeeping("review.ownBooking")
    : lock
      ? lock.lock === "exporting"
        ? tBookkeeping("exportingNow", { name: lockedBy })
        : tBookkeeping("exportUncertain", { name: lockedBy })
      : null;

  return (
    <PageShell
      // The same width as the form that made it.
      width="content"
      title={expense.title}
      // Before submission there is no reference: the name alone, not a gap.
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-x-2">
          {expense.reference && `${expense.reference} - `}
          <PersonName userId={expense.submitterId} name={expense.submitterName} />
        </span>
      }
      back="/expenses"
    >
      {/* The panel is declared here and stood beside the page by the shell: the utläggsräkning then the underlag (Fortnox stapling order),
      opening on the underlag. A draft shows its receipt alone (lib/expense/document-url.ts). */}
      <ReceiptPanelSource
        documents={documents}
        emptyTitle={tReceipt("alt")}
        emptyDescription={t("noReceipt")}
      />

      <ExpenseActionNotice can={can} fortnox={fortnox} paymentType={expense.paymentType} />

      {reviewers.length > 0 && (
        <Notice>
          {tBookkeeping("review.othersReviewing", {
            names: reviewerNames,
            count: reviewers.length,
          })}
        </Notice>
      )}

      {/* Voucher warnings: none stops the bokföring. */}
      {review && review.warnings.length > 0 && (
        <Notice>
          <p className="font-medium">{tBookkeeping("review.warningsTitle")}</p>
          <ul className="mt-1 list-disc pl-5">
            {review.warnings.map((w) => (
              <li key={w}>{tBookkeeping(`review.warning.${w}`)}</li>
            ))}
          </ul>
        </Notice>
      )}

      <Card>
        <ExpenseSummary
          expense={expense}
          actions={
            <ExpenseActions
              expenseId={expense.id}
              can={can}
              fortnox={fortnox}
              exportBlock={exportBlock}
              onExport={async () => {
                // Somebody else is looking it over too. Not a lock.
                if (
                  reviewers.length > 0 &&
                  !(await confirm({
                    title: tBookkeeping("review.confirmTitle"),
                    message: tBookkeeping("review.confirmMessage", {
                      names: reviewerNames,
                      count: reviewers.length,
                    }),
                    confirmLabel: t("review"),
                  }))
                ) {
                  return;
                }
                if (!(await mutations.exportToFortnox(expenseLabel(expense)))) live.refresh();
              }}
              busy={mutations.busy}
              onTransition={mutations.transition}
              onApprove={() => mutations.transition("approve")}
              approveAll={attestable > 1 ? attestable : null}
              onWithdrawAttest={() => mutations.withdrawAttest()}
              // How many rows are signed, so the confirmation can say what taking it back costs somebody else.
              onRecall={() =>
                mutations.recall(expense.allocations.filter((a) => a.approvedById).length)
              }
              onRevokeDeadlineWaiver={mutations.revokeDeadlineWaiver}
              onRemind={() => setReminding(true)}
              onDelete={mutations.remove}
            />
          }
        />

        <FactStrip expense={expense} />

        <NotesSection expense={expense} />

        {expense.paymentType === "CARD" && (
          <BankSection
            expense={expense}
            matched={matched}
            bankTransactions={bankTransactions}
            // The submitter's card, since matching someone else's utlägg offers their transactions and the route refuses any other.
            cardHolderId={expense.submitterId}
            canMatch={can.canMatch}
            matching={mutations.matching}
            onMatch={mutations.match}
          />
        )}

        <AllocationSection
          allocations={expense.allocations}
          rowActions={
            perRow
              ? {
                  canAttest: expense.status === "PENDING_APPROVAL",
                  withdrawable: can.withdrawableAllocationIds,
                  onAttest: (id) =>
                    onRow(id, () => mutations.transition("approve", undefined, [id])),
                  onWithdraw: (id, costCenter) =>
                    onRow(id, () => mutations.withdrawAttest({ id, costCenter })),
                  pending: rowBusy,
                  busy: mutations.busy,
                }
              : null
          }
        />

        {expense.verification && (
          <VerificationSection
            verification={expense.verification}
            expenseId={expense.id}
            revisions={expense.revisions}
            canEdit={can.canEditVerification}
          />
        )}

        <TimelineSection revisions={expense.revisions} />
      </Card>

      {reminding && (
        <ReminderDialog expenseIds={[expense.id]} onClose={() => setReminding(false)} />
      )}
    </PageShell>
  );
}

/** The bank side of a card purchase. Matched, a one-row table in the allocation's columns so the figures can be checked
 * against each other. Unmatched, the picker for whoever may match. */
function BankSection({
  expense,
  matched,
  bankTransactions,
  cardHolderId,
  canMatch,
  matching,
  onMatch,
}: {
  expense: Expense;
  matched: BankTransaction | undefined;
  bankTransactions: BankTransaction[];
  cardHolderId: string;
  canMatch: boolean;
  matching: boolean;
  onMatch: (transactionId: string | null) => void;
}) {
  const t = useTranslations("expenses.detail");
  const { date } = useFormat();
  // Which row was clicked: `matching` doesn't say which, and the list stays on screen.
  const [picked, setPicked] = useState<string | null>(null);

  if (matched) {
    // In the allocation table's columns, but drawn as a statement line on a tinted ground so the bank's figure is told from ours at once.
    const remove = canMatch ? (
      <Button variant="secondary" size="sm" loading={matching} onClick={() => onMatch(null)}>
        {t("removeMatch")}
      </Button>
    ) : null;
    const when = (
      <span className="text-xs leading-5 tabular-nums text-muted">
        {date(matched.transactionDate)}
      </span>
    );
    return (
      <section className="border-t border-border px-inset pb-4 pt-4">
        {/* `border-separate`: corner radii on a cell are ignored under collapsed borders. */}
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <caption className="sr-only">{t("bankTransaction")}</caption>
          <thead>
            <tr className="text-left">
              <th className={cn(LABEL, "pb-2 pr-3")}>{t("bankTransaction")}</th>
              <th className={cn(LABEL, "w-32 pb-2 text-right")}>{t("amount")}</th>
              <th className={cn(LABEL, "hidden w-[38%] pb-2 pl-6 sm:table-cell")}>
                {t("transactionDate")}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="align-top">
              <td className="rounded-l-control bg-surface py-2 pl-2.5 pr-3">
                <div className="flex min-w-0 items-center gap-2">
                  <PaymentIcon type="CARD" className="size-4 shrink-0" />
                  <span className="truncate font-medium">{matched.description}</span>
                  {matched.cardLast4 && (
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {cardMask(matched.cardLast4)}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 pl-6 sm:hidden">
                  {when}
                  {remove}
                </div>
              </td>
              <td className="whitespace-nowrap rounded-r-control bg-surface py-2 pr-2.5 text-right tabular-nums sm:rounded-r-none sm:pr-0">
                <Amount value={matched.amount} />
              </td>
              <td className="hidden rounded-r-control bg-surface py-2 pl-6 pr-1.5 sm:table-cell">
                <div className="flex items-center justify-between gap-3">
                  {when}
                  {remove}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    );
  }

  if (!canMatch) {
    return (
      <InspectorSection title={t("bankTransaction")}>
        <p className="text-sm text-muted">{t("noMatch")}</p>
      </InspectorSection>
    );
  }

  return (
    <InspectorSection title={t("bankTransaction")} aside={<MatchHelp />}>
      <div className="space-y-3">
        {/* Every row on this member's card, claimed ones included: the picker names the utlägg holding them. */}
        <TransactionPicker
          candidates={matchCandidates(
            bankTransactions.filter((t) => t.cardHolderId === cardHolderId),
            expense.grossAmount,
            null,
            expense.purchaseDate,
          )}
          amount={Math.abs(expense.grossAmount)}
          onPick={(id) => {
            setPicked(id);
            onMatch(id);
          }}
          busy={matching}
          pendingId={picked}
        />
      </div>
    </InspectorSection>
  );
}
