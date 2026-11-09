import { requirePage } from "@/lib/server/current-user";
import { canBookkeep } from "@/lib/domain/permissions";
import { getActiveAccounts, getBookkeepingSettings } from "@/lib/data/accounts";
import { getActiveCostCenters } from "@/lib/data/cost-centers";
import { getActiveProjects } from "@/lib/data/projects";
import { isRevenueAccount } from "@/lib/domain/voucher";
import { getExpense } from "@/lib/data/expenses";
import BookExpenseClient from "./book-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("bookExpense");

export default async function BookExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Same check POST /api/expenses/[id]/book makes: bookkeeping's alone.
  const user = await requirePage(canBookkeep);

  // Two waves: the pickers must still carry whatever this voucher already points at
  // (a since-retired account), so the expense loads first.
  const [expense, settings] = await Promise.all([getExpense(id, user), getBookkeepingSettings()]);

  const lines = expense?.verification?.lines ?? [];
  const [costCenters, accounts, projects] = await Promise.all([
    getActiveCostCenters([
      ...(expense?.allocations.map((a) => a.costCenterCode) ?? []),
      ...lines.flatMap((l) => (l.costCenterCode ? [l.costCenterCode] : [])),
    ]),
    getActiveAccounts([
      settings.bankAccount,
      settings.memberDebtAccount,
      ...lines.map((l) => l.account),
    ]),
    getActiveProjects(lines.flatMap((l) => (l.project ? [l.project] : []))),
  ]);

  // Keyed on the version: the screen's rows are state seeded from props once, so a new version must remount it.
  return (
    <BookExpenseClient
      key={expense?.updatedAt ?? "missing"}
      expense={expense}
      costCenters={costCenters}
      // No intäktskonton in the picker, but a voucher that already has one keeps it.
      accounts={accounts.filter(
        (a) => !isRevenueAccount(a.number) || lines.some((l) => l.account === a.number),
      )}
      projects={projects}
      settings={settings}
      returnHref={`/expenses/${id}`}
    />
  );
}
