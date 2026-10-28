import { requirePage } from "@/lib/server/current-user";
import { canBookkeep } from "@/lib/domain/permissions";
import { getExpense } from "@/lib/data/expenses";
import { getFortnoxStatus } from "@/lib/data/fortnox";
import { getActiveAccounts } from "@/lib/data/accounts";
import { getActiveCostCenters } from "@/lib/data/cost-centers";
import { getActiveProjects } from "@/lib/data/projects";
import { getReviewQueue } from "@/lib/data/review-queue";
import { fiscalYearWhere, getFiscalYear } from "@/lib/server/fiscal-year";
import { getLedgerYears } from "@/lib/ledger";
import { reviewWarnings, voucherTextPrefix } from "@/lib/domain/review";
import ReviewClient from "./review-client";

// Granska och bokför: the konterade utlägg, one at a time, each bokfört in
// Fortnox from here and nowhere else. See lib/domain/review.ts.
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await requirePage(canBookkeep);
  const { id: wanted } = await searchParams;

  // The same year as the Utlägg list whose "Granska" count brought you here,
  // so the queue holds the number the button said.
  const fiscal = await getFiscalYear();
  const [queue, fortnox] = await Promise.all([
    getReviewQueue(user, { during: fiscal ? fiscalYearWhere(fiscal) : undefined }),
    getFortnoxStatus(user.id),
  ]);

  // The one asked for, when it is konterat. It may be one this viewer may not
  // bokföra (they konterade it themselves); it is shown all the same, with the
  // reason, rather than swapped for another without a word. Otherwise the
  // first in the queue.
  const asked = wanted ? await getExpense(wanted, user) : null;
  const currentId = asked?.status === "BOOKED" ? asked.id : queue.ids[0];
  const expense =
    currentId === asked?.id ? asked : currentId ? await getExpense(currentId, user) : null;

  if (!expense) return <ReviewClient item={null} queue={queue} fortnox={fortnox} />;
  // Konterat means it has a voucher. One without is a broken row.
  const verification = expense.verification;
  if (!verification) throw new Error(`Expense ${expense.id} is BOOKED but has no verification`);
  const lines = verification.lines;

  const [accounts, costCenters, projects, years] = await Promise.all([
    getActiveAccounts(),
    getActiveCostCenters(),
    getActiveProjects(),
    getLedgerYears(),
  ]);

  const warnings = reviewWarnings({
    date: verification.date,
    financialYears: years,
    description: verification.description,
    textPrefix: voucherTextPrefix(expense.paymentType, expense.submitterStudentId),
    lines,
    isActiveAccount: (n) => accounts.some((a) => a.number === n),
    isActiveCostCenter: (c) => costCenters.some((cc) => cc.code === c),
    isActiveProject: (n) => projects.some((p) => p.number === n),
  });

  const index = queue.ids.indexOf(expense.id);
  // Where "next" goes: the one after this, round to the start, never itself.
  const others = queue.ids.filter((id) => id !== expense.id);
  const next = index === -1 ? (others[0] ?? null) : (others[index] ?? others[0] ?? null);

  return (
    <ReviewClient
      key={expense.id}
      item={{
        expense,
        warnings,
        // Not in the queue means this viewer may not bokföra it.
        ownBooking: index === -1,
        position: index === -1 ? null : index + 1,
        next,
      }}
      queue={queue}
      fortnox={fortnox}
    />
  );
}
