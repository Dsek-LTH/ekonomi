import { requirePage } from "@/lib/server/current-user";
import { canBookkeep } from "@/lib/domain/permissions";
import { getActiveAccounts, getBookkeepingSettings } from "@/lib/data/accounts";
import { getActiveCostCenters } from "@/lib/data/cost-centers";
import { getExpense } from "@/lib/data/expenses";
import BookExpenseClient from "./book-client";

export default async function BookExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Writing a verifikation is bookkeeping's alone. The same check
  // POST /api/expenses/[id]/book makes. The client renders an empty state for
  // an utlägg that isn't bookable *yet*; that is about the utlägg, not about
  // who is looking, and this is the half about who is looking.
  const user = await requirePage(canBookkeep);

  // Two waves: the pickers only offer active accounts/cost centres, but they
  // must still carry whatever this voucher already points at, otherwise
  // amending a voucher booked against a since-retired account would fail
  // validation with no way to fix it. So the expense has to load first.
  const [expense, settings] = await Promise.all([
    getExpense(id, user),
    getBookkeepingSettings(),
  ]);

  const lines = expense?.verification?.lines ?? [];
  const [costCenters, accounts] = await Promise.all([
    getActiveCostCenters([
      ...(expense?.allocations.map((a) => a.costCenterCode) ?? []),
      ...lines.flatMap((l) => (l.costCenterCode ? [l.costCenterCode] : [])),
    ]),
    getActiveAccounts([
      settings.bankAccount,
      settings.memberDebtAccount,
      ...lines.map((l) => l.account),
    ]),
  ]);

  return (
    <BookExpenseClient
      expense={expense}
      costCenters={costCenters}
      accounts={accounts}
      settings={settings}
    />
  );
}
