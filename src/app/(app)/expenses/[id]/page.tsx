import { requireUser } from "@/lib/server/current-user";
import { getBankTransactions, getBankTransactionsByIds } from "@/lib/data/bank";
import { getExpense } from "@/lib/data/expenses";
import { getFortnoxStatus } from "@/lib/data/fortnox";
import { expenseCapabilities } from "@/lib/domain/expense-capabilities";
import { getActiveAccounts } from "@/lib/data/accounts";
import { getActiveCostCenters } from "@/lib/data/cost-centers";
import { getActiveProjects } from "@/lib/data/projects";
import { getLedgerYears } from "@/lib/ledger";
import { reviewWarnings, voucherTextPrefix, type ReviewWarning } from "@/lib/domain/review";
import { exportReviewBlocker } from "@/lib/server/review";
import type { Expense } from "@/lib/domain/types";
import ExpenseDetailClient from "./detail-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("expense");

/** What bokföring of a konterat utlägg has to know: voucher warnings (none stop it) and whether the two-person rule hands it to somebody else. */
async function bookkeepingReview(
  expense: Expense,
  user: Parameters<typeof exportReviewBlocker>[1],
): Promise<{ warnings: ReviewWarning[]; ownBooking: boolean } | null> {
  const verification = expense.verification;
  if (!verification) return null;
  const [accounts, costCenters, projects, years, blocker] = await Promise.all([
    getActiveAccounts(),
    getActiveCostCenters(),
    getActiveProjects(),
    getLedgerYears(),
    exportReviewBlocker(expense.id, user),
  ]);
  const warnings = reviewWarnings({
    date: verification.date,
    financialYears: years,
    description: verification.description,
    textPrefix: voucherTextPrefix(expense.paymentType, expense.submitterStudentId),
    lines: verification.lines,
    isActiveAccount: (n) => accounts.some((a) => a.number === n),
    isActiveCostCenter: (c) => costCenters.some((cc) => cc.code === c),
    isActiveProject: (n) => projects.some((p) => p.number === n),
  });
  return { warnings, ownBooking: blocker === "ownBooking" };
}

export default async function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  // Two waves: the bank rows are the submitter's card purchases (the rule bank.txnNotExpenseCard enforces),
  // plus the one transaction this utlägg is already matched to.
  const [expense, fortnox] = await Promise.all([
    getExpense(id, user),
    // With the user id, so the status carries their own Fortnox login (exporting needs both).
    getFortnoxStatus(user.id),
  ]);

  // What this viewer may do, decided before the bank rows since it decides which the page may carry.
  const can = expense
    ? expenseCapabilities(expense, {
        id: user.id,
        roles: user.roles,
        capabilities: user.capabilities,
      })
    : null;

  const matched = expense?.matchedTransactionId ? [expense.matchedTransactionId] : [];
  const bankTransactions = !expense
    ? []
    : can?.canMatch
      ? await getBankTransactions({ cardHolderId: expense.submitterId, alsoIds: matched })
      : await getBankTransactionsByIds(matched);

  const review = expense && can?.canExport ? await bookkeepingReview(expense, user) : null;

  return (
    <ExpenseDetailClient
      expense={expense}
      can={can}
      bankTransactions={bankTransactions}
      fortnox={fortnox}
      review={review}
    />
  );
}
