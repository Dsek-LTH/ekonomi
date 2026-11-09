import { requireUser } from "@/lib/server/current-user";
import { fiscalYearWhere, getFiscalYear } from "@/lib/server/fiscal-year";
import { getDashboardExpenses } from "@/lib/data/expenses";
import { countUnaccountedPurchases } from "@/lib/data/bank";
import { getBudgetOverview } from "@/lib/data/budget-overview";
import { paceOf } from "@/lib/budget/overview";
import { buildQueue, type QueueAction } from "@/lib/domain/queue";
import { canViewBookkeeping, canAccessBudget, canViewMemberScores } from "@/lib/domain/permissions";
import { getMemberScore, getMemberScores } from "@/lib/data/member-score";
import { getPayoutAccount } from "@/lib/data/users";
import { ownedResultUnits } from "@/lib/server/result-units";
import {
  countStaleAttests,
  getOverdueInvoices,
  getUnitInvoices,
  getUpcoming,
  getWaitingOnOthers,
} from "@/lib/data/dashboard";
import { DashboardClient, type BudgetFlags, type TurnRow } from "./dashboard-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("dashboard");

// How many of your units' invoices the dashboard previews before handing you
// off to the list built for browsing.
//
// It lives here, on the server, because this is what decides how many rows are
// *fetched*. It cannot live in dashboard-client: that module is "use client",
// and a Server Component importing a value from one gets a client reference
// rather than the value.
const INVOICE_PREVIEW = 5;

// A member whose oldest purchase has waited this long is behind enough for the
// treasury to chase.
const BEHIND_DAYS = 30;

/** How many single late or due things Din tur names before the rest fall back
 *  into the counts under them. */
const SINGLES_SHOWN = 5;

// Översikt answers two questions side by side: what is your turn, and what of
// yours waits on somebody else. Being late or due soon is shown on a row, not
// given a card of its own, so nothing appears twice. Under them, the dates that
// ask nothing of you, the result units off pace with their budget and the
// invoices in your units. Figures are on the pages these link to.
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
    waiting,
    overdue,
    invoices,
  ] = await Promise.all([
    // One of your own is enough to tell a first visit from any other.
    getDashboardExpenses(user, 1, { during }),
    countUnaccountedPurchases(user.id, { during }),
    getPayoutAccount(user.id),
    watchesAll || watchesOwn ? getBudgetOverview(year) : null,
    // A rolling year, not the header's: see lib/domain/member-score.ts.
    getMemberScore(user.id),
    canViewMemberScores(user.capabilities) ? getMemberScores() : null,
    getUpcoming(user),
    getWaitingOnOthers(user.id),
    getOverdueInvoices(user),
    getUnitInvoices(user, INVOICE_PREVIEW),
  ]);

  const queue = buildQueue(queueCandidates, user);
  const staleAttests = await countStaleAttests(
    queue.filter((q) => q.action === "ATTEST").map((q) => q.expense.id),
  );

  // Din tur. First the single things that are late, the longest late first,
  // then the drafts whose filing deadline is near, the soonest first. A draft
  // with a deadline is named by its date, which says more than its age does.
  const deadlines = upcoming.filter((u) => u.kind === "deadline");
  const deadlineIds = new Set(deadlines.map((d) => d.id));
  const late = [
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
    ...overdue.map((o) => ({ kind: "invoiceOverdue" as const, ...o })),
  ].sort((a, b) => b.days - a.days);
  const singles = [
    ...late,
    ...deadlines.map((d) => ({
      kind: "deadline" as const,
      id: d.id,
      title: d.title,
      inDays: d.inDays,
    })),
  ].slice(0, SINGLES_SHOWN);

  // Then the counts. Whatever is named above is taken out of them, so a thing
  // is never on the page twice, and whatever did not fit falls back into them.
  const named = new Set(singles.map((r) => r.id));
  const count = (a: QueueAction) =>
    queue.filter((q) => q.action === a && !named.has(q.expense.id)).length;
  const namedPurchases = singles.filter((r) => r.kind === "cardPurchase").length;
  const namedDrafts = singles.some((r) => r.kind === "draft" || r.kind === "deadline");
  const hiddenOverdue = overdue.filter((o) => !named.has(o.id)).length;
  const behind = everyone?.filter((r) => (r.score.waiting[0]?.days ?? 0) > BEHIND_DAYS).length ?? 0;
  const counts: TurnRow[] = [
    { kind: "count", action: "FIX", count: count("FIX") },
    { kind: "count", action: "SUBMIT", count: count("SUBMIT"), more: namedDrafts },
    {
      kind: "count",
      action: "PURCHASES",
      count: Math.max(0, unaccountedPurchases - namedPurchases),
      more: namedPurchases > 0,
    },
    { kind: "count", action: "ATTEST", count: count("ATTEST"), stale: staleAttests },
    { kind: "count", action: "BOOK", count: count("BOOK") },
    { kind: "count", action: "EXPORT", count: count("EXPORT") },
    { kind: "count", action: "OVERDUE", count: hiddenOverdue },
    { kind: "count", action: "MEMBERS_BEHIND", count: behind },
  ];
  const turn: TurnRow[] = [...singles, ...counts.filter((r) => r.kind !== "count" || r.count > 0)];

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
    // Every unit with a cost budget, the ones off pace first and the furthest
    // gone first among them, so the card can show the worst few as bars.
    const rank = { OVER: 0, AHEAD: 1, ON_TRACK: 2 } as const;
    budget = {
      budgetId: overview.budget?.id ?? null,
      scope: watchesAll ? "all" : "own",
      ownCount: owned.names.length,
      elapsed: Math.round(elapsed * 100),
      units: units
        .flatMap((u) => {
          const pace = paceOf(u.cost, elapsed);
          if (!pace) return [];
          return [{ name: u.name, pace, used: Math.round((u.cost.actual / u.cost.budget) * 100) }];
        })
        .sort((a, b) => rank[a.pace] - rank[b.pace] || b.used - a.used),
    };
  }

  return (
    <DashboardClient
      firstName={user.name.split(" ")[0]}
      // Everything late, not only the few named in Din tur: the tile over it
      // counts what is behind, and a stale attest is behind too.
      lateCount={late.length + staleAttests}
      payoutMissing={!payout.clearing || !payout.account}
      turn={turn}
      waiting={waiting}
      calendar={upcoming.filter((u) => u.kind !== "deadline")}
      budget={budget}
      fresh={mine.length === 0 && invoices.length === 0}
      invoices={invoices}
      score={score.score}
    />
  );
}
