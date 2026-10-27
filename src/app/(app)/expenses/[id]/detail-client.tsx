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
import { matchCandidates } from "@/lib/domain/matching";
import { useFormat } from "@/lib/ui/use-format";
import type { BankTransaction, Expense, FortnoxStatus } from "@/lib/domain/types";
import {
  AllocationSection,
  ExpenseSummary,
  FactStrip,
  InspectorSection,
  NotesSection,
  TimelineSection,
  VerificationSection,
} from "./detail-sections";
import { ExpenseActionNotice, ExpenseActions } from "./expense-actions";
import { ReminderDialog } from "@/components/reminder-dialog";
import type { ExpenseCapabilities } from "@/lib/domain/expense-capabilities";
import { useExpenseMutations } from "./use-expense-mutations";

export default function ExpenseDetailClient({
  expense,
  can,
  bankTransactions,
  fortnox,
}: {
  expense: Expense | null;
  // Null exactly when `expense` is: there is nothing to be capable of. The two
  // are narrowed together below so the detail view sees both as present.
  can: ExpenseCapabilities | null;
  bankTransactions: BankTransaction[];
  fortnox: FortnoxStatus;
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
}: {
  expense: Expense;
  /** Decided on the server. See expenseCapabilities. */
  can: ExpenseCapabilities;
  bankTransactions: BankTransaction[];
  fortnox: FortnoxStatus;
}) {
  const t = useTranslations("expenses.detail");
  const tReceipt = useTranslations("receipt");
  const mutations = useExpenseMutations(expense.id);
  const [reminding, setReminding] = useState(false);
  const documents = expenseDocuments(
    expense,
    `${tReceipt("alt")} - ${expense.title}`,
    // The panel stacks the two into one scroll, so each is captioned.
    { cover: tReceipt("coverLabel"), underlag: tReceipt("underlagLabel") },
  );
  const matched = bankTransactions.find((t) => t.id === expense.matchedTransactionId);

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
        expense.reference
          ? `${expense.reference} - ${expense.submitterName}`
          : expense.submitterName
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

      {/* The inspector. One card, read top to bottom; see detail-sections.tsx
          for why it is not a stack of cards. */}
      <Card>
        <ExpenseSummary
          expense={expense}
          actions={
            <ExpenseActions
              expenseId={expense.id}
              can={can}
              busy={mutations.busy}
              onTransition={mutations.transition}
              onWithdrawAttest={mutations.withdrawAttest}
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

        <AllocationSection allocations={expense.allocations} />

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
 * Matched, it is the transaction as the bank list draws it: what and how much
 * on the first line, when under it, so it can be checked
 * against the receipt beside it without leaving the page. Taking the match off
 * is a button in the section's heading, where every other section keeps its
 * action. It used to be a line of small print beside the date, where it read
 * as part of the date. Unmatched, it is the picker for whoever may match, and
 * a plain sentence for whoever may not.
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
    return (
      <InspectorSection
        title={t("bankTransaction")}
        action={
          canMatch ? (
            <Button
              variant="secondary"
              size="sm"
              loading={matching}
              onClick={() => onMatch(null)}
            >
              {t("removeMatch")}
            </Button>
          ) : undefined
        }
      >
        <div className="flex items-start justify-between gap-4 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">{matched.description}</p>
            <p className="mt-0.5 text-xs tabular-nums text-muted">{date(matched.transactionDate)}</p>
          </div>
          <span className="shrink-0">
            <Amount value={matched.amount} />
          </span>
        </div>
      </InspectorSection>
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
