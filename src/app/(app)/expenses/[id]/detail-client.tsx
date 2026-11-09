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

/** What bokföring this utlägg has to know, for whoever may do it. Worked out
 *  on the server; see bookkeepingReview in page.tsx. */
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
  // Which row's button was pressed, so the spinner lands on that one.
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  async function onRow(id: string, act: () => Promise<unknown>) {
    setRowBusy(id);
    await act();
    setRowBusy(null);
  }
  const documents = expenseDocuments(
    expense,
    `${tReceipt("alt")} - ${expense.title}`,
    // The panel stacks the two into one scroll, so each is captioned.
    { cover: tReceipt("coverLabel"), underlag: tReceipt("underlagLabel") },
  );
  const matched = bankTransactions.find((t) => t.id === expense.matchedTransactionId);

  // Somebody else sending it to Fortnox right now, or an export that ended
  // without an answer: either way not one to send again from here. Asked only
  // where it could be sent.
  const live = useLiveBookkeeping(can.canExport);
  const { list } = useFormat();
  const confirm = useConfirm();
  // Who else granskar this konterat utlägg right now. Announced only by
  // somebody who could bokföra it from here, so not by whoever konterade it.
  // Advisory, like the booking screen's: the export lock is what stops a
  // second export. No version to compare against, since nothing is typed here.
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
      // The same width as the form that made it, so opening an utlägg after
      // filling one in does not shrink the page into a narrow column.
      width="content"
      title={expense.title}
      // Before it is submitted there is no reference to show, and the status
      // pill below already says so, the name alone, not a gap where a number
      // would be.
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-x-2">
          {expense.reference && `${expense.reference} - `}
          <PersonName userId={expense.submitterId} name={expense.submitterName} />
        </span>
      }
      back="/expenses"
    >
      {/* The receipt is the app's panel now, not a card in this page. The page
          declares it and the shell stands it beside all of this, full height.

          Two documents, not one: the utläggsräkning (the cover page naming
          who attested what) and the underlag behind it, with the panel's pager
          between them. They are in the order they are stapled in for Fortnox,
          which is what makes paging through them a reading of the thing the
          section will actually file; a document you cannot see until it is in
          somebody else's system is one nobody checks.

          It opens on the second of them all the same. The receipt is what
          somebody comes to this page to look at. The cover is generated from
          data already on screen beside it, so the panel lands there and the
          cover is a page back.

          A draft has no cover worth drawing and shows its receipt alone.
          See lib/expense/document-url.ts. */}
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

      {/* What is worth a second look on the voucher before it goes. None of it
          stops the bokföring: each is something a person may have meant. */}
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

      {/* The inspector. One card, read top to bottom; see detail-sections.tsx
          for why it is not a stack of cards. */}
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
                // Somebody else is looking it over too. Not a lock, but the
                // one bokföring it first should know they are doing so.
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
              // How many rows are already signed, so the confirmation can say
              // what taking it back actually costs somebody else.
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
            // Whose card the purchase was on, which is the submitter's,
            // matching someone else's utlägg means offering their
            // transactions, and the route refuses any other.
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

      {/* The send refreshes the page, which puts the reminder in the history. */}
      {reminding && (
        <ReminderDialog expenseIds={[expense.id]} onClose={() => setReminding(false)} />
      )}
    </PageShell>
  );
}

/**
 * The bank side of a card purchase, in one place whatever state it is in.
 *
 * Matched, it is a one-row table in the allocation's columns (see below), so
 * the bank's figure sits straight above the allocation's and the two can be
 * checked against each other and the receipt without leaving the page. Taking
 * the match off is a button at the end of that row. Unmatched, it is the
 * picker for whoever may match, and a plain sentence for whoever may not.
 */
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
  // Which row was clicked. `matching` says a write is in flight but not which
  // one, and the list stays on screen throughout, so without this the click
  // looks ignored.
  const [picked, setPicked] = useState<string | null>(null);

  if (matched) {
    // Laid out in the allocation table's columns, so the bank's figure sits
    // straight above the allocation's, but drawn as a statement line rather
    // than as one more row of the card: the line itself on a tinted, rounded
    // ground, with the card mark and number at its head. The two tables are
    // read against each other, and the eye has to tell at once which is the
    // bank's and which is ours.
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
        {/* `border-separate`: corners on a cell are ignored under the
            collapsed borders a table has by default. */}
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
                {/* On a phone the third column is gone, so what it holds
                    comes under the description, as the attest does below. */}
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
    // How matching works is behind the "?" beside the heading, the same as on
    // the form, rather than a paragraph above the list.
    <InspectorSection title={t("bankTransaction")} aside={<MatchHelp />}>
      <div className="space-y-3">
        {/* Every row on this member's card, the claimed ones included. They
            used to be filtered out here, so a purchase somebody else had
            already redovisat simply was not in the list and the reason was
            unfindable. The picker names the utlägg holding them. */}
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
