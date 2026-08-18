"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { IconLink } from "@/components/ui/icons";
import { ReceiptPanelSource } from "@/components/receipt/receipt-panel";
import { expenseDocuments } from "@/lib/expense/document-url";
import { Amount } from "@/components/ui/amount";
// For the amount that sits inside a translated sentence ("Pick a transaction for
// exactly …"), where a React node cannot go. Everything rendered as a figure in
// its own right uses Amount.
import { formatSEK } from "@/lib/ui/format";
import { cancelsOut } from "@/lib/domain/matching";
import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";
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
  /** Decided on the server — see expenseCapabilities. */
  can: ExpenseCapabilities;
  bankTransactions: BankTransaction[];
  fortnox: FortnoxStatus;
}) {
  const t = useTranslations("expenses.detail");
  const tNav = useTranslations("nav");
  const tReceipt = useTranslations("receipt");
  const mutations = useExpenseMutations(expense.id);
  const documents = expenseDocuments(expense, `${tReceipt("alt")} · ${expense.title}`);

  return (
    <PageShell
      width="content"
      title={expense.title}
      // Before it is submitted there is no reference to show, and the status
      // pill below already says so — the name alone, not a gap where a number
      // would be.
      subtitle={
        expense.reference
          ? `${expense.reference} - ${expense.submitterName}`
          : expense.submitterName
      }
      description={<StatusPill status={expense.status} />}
      back={{ href: "/expenses", label: tNav("expenses") }}
    >
      {/* The receipt is the app's panel now, not a card in this page — the page
          declares it and the shell stands it beside all of this, full height.

          Two documents, not one: the utläggsräkning — the cover page naming
          who attested what — and the underlag behind it, with the panel's
          pager between them. Stapled together they are what gets attached to
          the voucher in Fortnox, and being able to read that here is most of
          the reason to render it at all; a document you cannot see until it is
          in somebody else's system is one nobody checks.

          A draft has no cover worth drawing and shows its receipt alone.
          See lib/expense/document-url.ts. */}
      <ReceiptPanelSource
        documents={documents}
        emptyTitle={tReceipt("alt")}
        emptyDescription={t("noReceipt")}
      />

      <ExpenseActionNotice can={can} fortnox={fortnox} />

      {/* min-w-0: without it a grid item's own min-width is auto, so one long
          unbroken string — a cost-centre name, a receipt filename — widens the
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
                onExport={mutations.exportToFortnox}
                onDelete={mutations.remove}
              />
            }
          />

          {expense.paymentType === "CARD" && (
            <BankTransactionCard
              expense={expense}
              bankTransactions={bankTransactions}
              // Whose card the purchase was on, which is the submitter's —
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

// Shows the matched transaction, or — for someone who may still match — a
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
  const { date } = useFormat();
  const txn = bankTransactions.find((t) => t.id === expense.matchedTransactionId);

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
          <TransactionPicker
            // Every unmatched purchase on this member's card, not just the ones
            // that fit: the picker greys out the rest, so a mistyped amount
            // shows up as "the right purchase is there but not selectable"
            // instead of an empty list.
            transactions={bankTransactions.filter(
              (t) => !t.matchedExpenseId && t.cardHolderId === cardHolderId,
            )}
            grossAmount={expense.grossAmount}
            onSelect={onMatch}
            disabled={matching}
          />
        ) : (
          <p className="text-sm text-muted">{t("noMatch")}</p>
        )}
      </CardBody>
    </Card>
  );
}

function TransactionPicker({
  transactions,
  grossAmount,
  onSelect,
  disabled,
}: {
  transactions: BankTransaction[];
  /** The expense's amount — only a row that cancels it out can be picked. */
  grossAmount: number;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations("expenses.detail");
  const tList = useTranslations("expenses");
  const { date } = useFormat();
  const [query, setQuery] = useState("");
  // Which row was clicked. `disabled` says a match is being written but not
  // which one, and the answer is the only thing worth showing here — the list
  // stays on screen throughout, so without it the click looks ignored.
  const [picked, setPicked] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const filtered = transactions
    .filter((t) => !q || t.description.toLowerCase().includes(q))
    .map((txn) => ({ txn, selectable: cancelsOut(txn.amount, grossAmount) }))
    // Selectable first; within each group the incoming date order (newest
    // first) is kept, so the list stays predictable.
    .sort((a, b) => Number(b.selectable) - Number(a.selectable));

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        {t("pickTransaction", { amount: formatSEK(Math.abs(grossAmount)) })}
      </p>
      <SearchInput
        placeholder={t("searchTransaction")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="max-h-52 divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {filtered.map(({ txn, selectable }) => (
          <li key={txn.id}>
            <button
              onClick={() => {
                setPicked(txn.id);
                onSelect(txn.id);
              }}
              disabled={disabled || !selectable}
              title={selectable ? undefined : t("amountMismatch")}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors disabled:pointer-events-none",
                selectable ? "hover:bg-surface disabled:opacity-40" : "opacity-45",
              )}
            >
              {/* The spinner sits in the link glyph's box so the row doesn't
                  shift under the pointer while the match is written. */}
              <span className="grid size-4 shrink-0 place-items-center">
                {disabled && picked === txn.id ? (
                  <Spinner size="sm" className="text-accent" />
                ) : (
                  <IconLink className="size-4 text-muted" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{txn.description}</p>
                <p className="text-xs text-muted">
                  {date(txn.transactionDate)}
                  {txn.cardHolderName && <> · {txn.cardHolderName}</>}
                  {!selectable && ` · ${t("otherAmount")}`}
                </p>
              </div>
              <span className="shrink-0"><Amount value={txn.amount} /></span>
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-4 py-4 text-center text-sm text-muted">
            {t("noUnmatched")}
          </li>
        )}
      </ul>
      <p className="text-xs text-muted">{tList("noMatchHint")}</p>
    </div>
  );
}
