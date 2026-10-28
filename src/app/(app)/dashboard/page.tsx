import { requireUser } from "@/lib/server/current-user";
import { fiscalYearWhere, getFiscalYear } from "@/lib/server/fiscal-year";
import { getDashboardExpenses } from "@/lib/data/expenses";
import { countUnaccountedPurchases } from "@/lib/data/bank";
import { getBudgetOverview } from "@/lib/data/budget-overview";
import { buildQueue } from "@/lib/domain/queue";
import { canViewBookkeeping, canAccessBudget } from "@/lib/domain/permissions";
import { getMyMoney } from "@/lib/data/my-money";
import { getPayoutAccount } from "@/lib/data/users";
import { ownedResultUnits } from "@/lib/server/result-units";
import { DashboardClient } from "./dashboard-client";
import type { DashboardView } from "./view";

// How many of your own utlägg the dashboard previews before handing you off to
// the list built for browsing. The old page said "senaste" and then rendered
// every one of them, which made it an unbounded copy of /expenses.
//
// It lives here, on the server, because this is what decides how many rows are
// *fetched*. It cannot live in dashboard-client: that module is "use client",
// and a Server Component importing a value from one gets a client reference
// rather than the value: `take: [object Function]`, which is exactly what
// Prisma reported when it did.
const MINE_PREVIEW = 5;

// Two columns. The right one is yours and the same for everybody: what is
// waiting on you, and your own utlägg. The left one depends on who you are,
// because most members care about their own money and only a few about the
// section's:
//
//   • answering for no budget: what the section owes you (getMyMoney), and a
//     link to the budget for the curious.
//   • an utskottsmästare: the result units they answer for.
//   • skattmästeriet: every result unit.
//
// Somebody with both of the last two picks between them, the way Mina and Alla
// are picked on Utlägg and Bank. The choice is in the URL as `?scope=`, the
// same as on every list, and one they may not have falls back to the first
// they do.
//
// It used to be one queue table for everyone, then a budget card for everyone.
// The second was right that people did not know the budget existed and wrong
// about who needed to: the members who answer for one.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const now = new Date();
  // The header's räkenskapsår, as the calendar year the budget is kept in.
  // Without a synced year, this one.
  const fiscal = await getFiscalYear();
  const year = fiscal ? Number(fiscal.fromDate.slice(0, 4)) : now.getFullYear();
  const during = fiscal ? fiscalYearWhere(fiscal) : undefined;

  const owned = await ownedResultUnits(user);
  const answersForUnits = owned.names.length > 0;
  const readsBudget = canAccessBudget(user.capabilities);
  const views: DashboardView[] = readsBudget
    ? [
        ...(answersForUnits ? (["unit"] as const) : []),
        ...(answersForUnits || canViewBookkeeping(user.capabilities) ? (["section"] as const) : []),
      ]
    : [];
  if (views.length === 0) views.push("personal");
  const view = views.find((v) => v === params.scope) ?? views[0];

  const [{ queueCandidates, mine }, unaccountedPurchases, payout, overview, money] =
    await Promise.all([
      // What waits on you and your own latest, in the year too: Översikt
      // reads the same year as every list it links to. See docs/navigation.md.
      getDashboardExpenses(user, MINE_PREVIEW, { during }),
      countUnaccountedPurchases(user.id, { during }),
      getPayoutAccount(user.id),
      view === "personal" ? null : getBudgetOverview(year),
      view === "personal" ? getMyMoney(user.id, year) : null,
    ]);

  // Decided here rather than in the browser, so the marker does not move
  // between the server's render and the client's.
  // A past year is all gone, a future one not begun.
  const start = fiscal ? Date.parse(`${fiscal.fromDate}T00:00:00`) : new Date(year, 0, 1).getTime();
  const end = fiscal ? Date.parse(`${fiscal.toDate}T23:59:59`) : new Date(year + 1, 0, 1).getTime();
  const yearElapsed = Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));

  return (
    <DashboardClient
      firstName={user.name.split(" ")[0]}
      view={view}
      views={views}
      queue={buildQueue(queueCandidates, user)}
      unaccountedPurchases={unaccountedPurchases}
      payoutMissing={!payout.clearing || !payout.account}
      budget={overview && { overview, ownUnits: owned.names, yearElapsed }}
      money={money}
      showBudgetLink={readsBudget}
      // Already newest first out of the query: your own list answers "where did
      // mine get to", which reads backwards from the queue, where the oldest
      // thing is the urgent one.
      mine={mine}
    />
  );
}
