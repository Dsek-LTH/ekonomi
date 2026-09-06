"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { NoMatchNote, TransactionPicker } from "@/components/transaction-picker";
import { expenseDocuments } from "@/lib/expense/document-url";
import { Amount } from "@/components/ui/amount";
// For the amount that sits inside a translated sentence ("Pick a transaction for
// exactly …"), where a React node cannot go. Everything rendered as a figure in
// its own right uses Amount.
import { formatSEK } from "@/lib/ui/format";
import { cancelsOut, matchCandidates } from "@/lib/domain/matching";
import { useFormat } from "@/lib/ui/use-format";
import type { BankTransaction, Expense, FortnoxStatus } from "@/lib/domain/types";
import { DetailsCard, TimelineCard, VerificationCard } from "./detail-sections";
import { ExpenseActionNotice, ExpenseActions } from "./expense-actions";
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
  const tNav = useTranslations("nav");
  const tReceipt = useTranslations("receipt");
  const mutations = useExpenseMutations(expense.id);
  const documents = expenseDocuments(expense, `${tReceipt("alt")} – ${expense.title}`);

  return (
    <PageShell
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
      description={<StatusPill status={expense.status} />}
      back={{ href: "/expenses", label: tNav("expenses") }}
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

      {/* min-w-0: without it a grid item's own min-width is auto, so one long
          unbroken string (a cost-centre name, a receipt filename) widens the
          column past the screen instead of being truncated inside its card. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <div className="min-w-0 space-y-6">
          <DetailsCard
            expense={expense}
            action={
              <ExpenseActions
                expenseId={expense.id}
                can={can}
                fortnox={fortnox}
                busy={mutations.busy}
                onTransition={mutations.transition}
                onWithdrawAttest={mutations.withdrawAttest}
                // How many rows are already signed, so the confirmation can say
                // what taking it back actually costs somebody else.
                onRecall={() =>
                  mutations.recall(
                    expense.allocations.filter((a) => a.approvedById).length,
                  )
                }
                onRevokeDeadlineWaiver={mutations.revokeDeadlineWaiver}
                onExport={mutations.exportToFortnox}
                onDelete={mutations.remove}
              />
            }
          />

          {expense.paymentType === "CARD" && (
            <BankTransactionCard
              expense={expense}
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

          {expense.verification && (
            <VerificationCard
              verification={expense.verification}
              expenseId={expense.id}
              canEdit={can.canEditVerification}
            />
          )}

          <TimelineCard revisions={expense.revisions} />
        </div>
      </div>
    </PageShell>
  );
}

// Shows the matched transaction, or, for someone who may still match, a
// picker over their own unmatched purchases of the same amount.
function BankTransactionCard({
  expense,
  bankTransactions,
  cardHolderId,
  canMatch,
  matching,
  onMatch,
}: {
  expense: Expense;
  bankTransactions: BankTransaction[];
  cardHolderId: string;
  canMatch: boolean;
  matching: boolean;
  onMatch: (transactionId: string | null) => void;
}) {
  const t = useTranslations("expenses.detail");
  const tMatch = useTranslations("expenses.match");
  const { date } = useFormat();
  const txn = bankTransactions.find((t) => t.id === expense.matchedTransactionId);
  // Which row was clicked. `matching` says a write is in flight but not which
  // one, and the list stays on screen throughout, so without this the click
  // looks ignored.
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader title={t("bankTransaction")} />
      <CardBody className="space-y-3">
        {txn ? (
          <>
            <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium">{txn.description}</p>
                <p className="text-xs text-muted">{date(txn.transactionDate)}</p>
              </div>
              <Amount value={txn.amount} />
            </div>
            {canMatch && (
              <button
                onClick={() => onMatch(null)}
                disabled={matching}
                aria-busy={matching || undefined}
                className="inline-flex items-center gap-1.5 text-xs text-muted underline-offset-2 hover:text-foreground hover:underline disabled:opacity-40"
              >
                {matching && <Spinner size="sm" />}
                {t("removeMatch")}
              </button>
            )}
          </>
        ) : canMatch ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">
              {tMatch("lead", { amount: formatSEK(Math.abs(expense.grossAmount)) })}
            </p>
            {/* Every row on this member's card, the claimed ones included. They
                used to be filtered out here, so a purchase somebody else had
                already redovisat simply was not in the list and the reason was
                unfindable. The picker greys them and names the utlägg holding
                them. */}
            <TransactionPicker
              candidates={matchCandidates(
                bankTransactions.filter((t) => t.cardHolderId === cardHolderId),
                expense.grossAmount,
              )}
              onPick={(id) => {
                setPicked(id);
                onMatch(id);
              }}
              busy={matching}
              pendingId={picked}
            />
            {!bankTransactions.some(
              (t) =>
                t.cardHolderId === cardHolderId &&
                !t.matchedExpenseId &&
                cancelsOut(t.amount, expense.grossAmount),
            ) && <NoMatchNote hasRows={bankTransactions.length > 0} />}
          </div>
        ) : (
          <p className="text-sm text-muted">{t("noMatch")}</p>
        )}
      </CardBody>
    </Card>
  );
}
