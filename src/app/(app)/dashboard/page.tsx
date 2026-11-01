import { requireUser } from "@/lib/server/current-user";
import { fiscalYearWhere, getFiscalYear } from "@/lib/server/fiscal-year";
import { getDashboardExpenses } from "@/lib/data/expenses";
import { countUnaccountedPurchases } from "@/lib/data/bank";
import { getBudgetOverview } from "@/lib/data/budget-overview";
import { paceOf } from "@/lib/budget/overview";
import { buildQueue } from "@/lib/domain/queue";
import { canViewBookkeeping, canAccessBudget, canViewMemberScores } from "@/lib/domain/permissions";
import { getMemberScore, getMemberScores } from "@/lib/data/member-score";
import { getPayoutAccount } from "@/lib/data/users";
import { ownedResultUnits } from "@/lib/server/result-units";
import {
  countStaleAttests,
  getOverdueInvoices,
  getStuckOwn,
  getUnitInvoices,
  getUpcoming,
} from "@/lib/data/dashboard";
import { DashboardClient, type BudgetFlags, type ForgottenRow } from "./dashboard-client";

// How many of your own utlägg, and of your units' invoices, the dashboard
// previews before handing you off to the list built for browsing.
//
// It lives here, on the server, because this is what decides how many rows are
// *fetched*. It cannot live in dashboard-client: that module is "use client",
// and a Server Component importing a value from one gets a client reference
// rather than the value.
const MINE_PREVIEW = 5;

// A member whose oldest purchase has waited this long is behind enough for the
// treasury to chase.
const BEHIND_DAYS = 30;

// Översikt is a strip across time and two cards under it. Glömt is what should
// already have happened, Att göra is what waits on you now, Kommande is what
// has a date soon. Under them, the result units off pace with their budget and
// your own latest utlägg and invoices. Figures are on the pages these link to.
export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();
  // The header's räkenskapsår, as the calendar year the budget is kept in.
  // Without a synced year, this one.
  const fiscal = await getFiscalYear();
  const year = fiscal ? Number(fiscal.fromDate.slice(0, 4)) : now.getFullYear();
  const during = fiscal ? fiscalYearWhere(fiscal) : undefined;

  // Whose units the budget card watches: every one for the treasury, the ones
  // you answer for as an utskottsmästare, none for everybody else.
  const owned = await ownedResultUnits(user);
  const watchesAll = canAccessBudget(user.capabilities) && canViewBookkeeping(user.capabilities);
  const watchesOwn = canAccessBudget(user.capabilities) && owned.names.length > 0;

  const [
    { queueCandidates, mine },
    unaccountedPurchases,
    payout,
    overview,
    score,
    everyone,
    upcoming,
    stuck,
    overdue,
    invoices,
  ] = await Promise.all([
    getDashboardExpenses(user, MINE_PREVIEW, { during }),
    countUnaccountedPurchases(user.id, { during }),
    getPayoutAccount(user.id),
    watchesAll || watchesOwn ? getBudgetOverview(year) : null,
    // A rolling year, not the header's: see lib/domain/member-score.ts.
    getMemberScore(user.id),
    canViewMemberScores(user.capabilities) ? getMemberScores() : null,
    getUpcoming(user),
    getStuckOwn(user.id),
    getOverdueInvoices(user),
    getUnitInvoices(user, MINE_PREVIEW),
  ]);

  const queue = buildQueue(queueCandidates, user);
  const staleAttests = await countStaleAttests(
    queue.filter((q) => q.action === "ATTEST").map((q) => q.expense.id),
  );

  // Glömt: counts that stand for many first, then the single things, the
  // longest forgotten first. A draft whose filing deadline is coming up is
  // under Kommande with its date instead, which says more than its age does.
  const deadlineIds = new Set(upcoming.filter((u) => u.kind === "deadline").map((u) => u.id));
  const behind = everyone?.filter((r) => (r.score.waiting[0]?.days ?? 0) > BEHIND_DAYS).length ?? 0;
  const forgotten: ForgottenRow[] = [
    ...(staleAttests > 0 ? [{ kind: "attestWaiting" as const, count: staleAttests }] : []),
    ...(behind > 0 ? [{ kind: "membersBehind" as const, count: behind }] : []),
    ...[
      // What the redovisningsbetyg already counts as late: drafts and card
      // purchases past its grace days.
      ...score.waiting
        .filter((w) => w.kind !== "submitted" && !deadlineIds.has(w.id))
        .map((w) => ({
          kind: w.kind === "cardPurchase" ? ("cardPurchase" as const) : ("draft" as const),
          id: w.id,
          title: w.title,
          days: w.days,
        })),
      ...stuck.map((s) => ({ kind: "stuck" as const, ...s })),
      ...overdue.map((o) => ({ kind: "invoiceOverdue" as const, ...o })),
    ].sort((a, b) => b.days - a.days),
  ];

  // Decided here rather than in the browser, so the figure does not move
  // between the server's render and the client's.
  const start = fiscal ? Date.parse(`${fiscal.fromDate}T00:00:00`) : new Date(year, 0, 1).getTime();
  const end = fiscal ? Date.parse(`${fiscal.toDate}T23:59:59`) : new Date(year + 1, 0, 1).getTime();
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));

  let budget: BudgetFlags | null = null;
  if (overview) {
    const units = watchesAll
      ? overview.units
      : overview.units.filter((u) => u.name !== null && owned.names.includes(u.name));
    budget = {
      budgetId: overview.budget?.id ?? null,
      scope: watchesAll ? "all" : "own",
      ownCount: owned.names.length,
      elapsed: Math.round(elapsed * 100),
      flagged: units.flatMap((u) => {
        const pace = paceOf(u.cost, elapsed);
        if (pace !== "OVER" && pace !== "AHEAD") return [];
        return [{ name: u.name, pace, used: Math.round((u.cost.actual / u.cost.budget) * 100) }];
      }),
    };
  }

  return (
    <DashboardClient
      queue={queue}
      unaccountedPurchases={unaccountedPurchases}
      payoutMissing={!payout.clearing || !payout.account}
      forgotten={forgotten}
      upcoming={upcoming}
      budget={budget}
      // Already newest first out of the query: your own list answers "where did
      // mine get to", which reads backwards from the queue.
      mine={mine}
      invoices={invoices}
      stars={score.stars}
    />
  );
}
