import { requirePage } from "@/lib/server/current-user";
import { canBookkeep } from "@/lib/domain/permissions";
import { getActiveAccounts, getBookkeepingSettings } from "@/lib/data/accounts";
import { getActiveCostCenters } from "@/lib/data/cost-centers";
import { getActiveProjects } from "@/lib/data/projects";
import { isRevenueAccount } from "@/lib/domain/voucher";
import { getExpense } from "@/lib/data/expenses";
import BookExpenseClient from "./book-client";

export default async function BookExpensePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ review?: string }>;
}) {
  const { id } = await params;
  // Opened from Granska och bokför: back there when done, at this utlägg. A
  // flag rather than a return address, so the page cannot be sent anywhere.
  const fromReview = (await searchParams).review === "1";
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

  // Keyed on the utlägg's version. The screen's rows are state seeded from the
  // props once, so a refresh after somebody else saved would otherwise keep
  // showing the voucher as it was typed against the old version. A new version
  // is a new screen. See presence-notices.tsx.
  return (
    <BookExpenseClient
      key={expense?.updatedAt ?? "missing"}
      expense={expense}
      costCenters={costCenters}
      // No intäktskonton: an utlägg is never booked against one, so the picker
      // does not offer them. A voucher that already has one keeps it, so the
      // row still says what it holds and the screen can say why it is refused.
      accounts={accounts.filter(
        (a) => !isRevenueAccount(a.number) || lines.some((l) => l.account === a.number),
      )}
      projects={projects}
      settings={settings}
      returnHref={fromReview ? `/expenses/review?id=${id}` : `/expenses/${id}`}
    />
  );
}
