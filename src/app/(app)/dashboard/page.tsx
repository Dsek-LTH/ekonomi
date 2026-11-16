import { requireUser } from "@/lib/server/current-user";
import { fiscalYearWhere, getFiscalYear } from "@/lib/server/fiscal-year";
import { getDashboardExpenses } from "@/lib/data/expenses";
import { getBudgetOverview } from "@/lib/data/budget-overview";
import { paceOf } from "@/lib/budget/overview";
import { buildQueue } from "@/lib/domain/queue";
import { today } from "@/lib/domain/date";
import { bandTodos, type TodoGroup } from "@/lib/domain/todo";
import { canViewBookkeeping, canAccessBudget, canViewMemberScores } from "@/lib/domain/permissions";
import { getMemberScore, getMemberScores } from "@/lib/data/member-score";
import { getPayoutAccount } from "@/lib/data/users";
import { getTodos } from "@/lib/data/todo";
import { ownedResultUnits } from "@/lib/server/result-units";
import { getUpcoming, getWaitingOnOthers } from "@/lib/data/dashboard";
import { DashboardClient, type BudgetFlags } from "./dashboard-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("dashboard");

/** A member with a purchase waiting this long is behind. */
const BEHIND_DAYS = 30;

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();
  const day = today();
  const fiscal = await getFiscalYear();
  const year = fiscal ? Number(fiscal.fromDate.slice(0, 4)) : now.getFullYear();
  const during = fiscal ? fiscalYearWhere(fiscal) : undefined;

  const owned = await ownedResultUnits(user);
  const watchesAll = canAccessBudget(user.capabilities) && canViewBookkeeping(user.capabilities);
  const watchesOwn = canAccessBudget(user.capabilities) && owned.names.length > 0;

  const [{ queueCandidates, mine }, payout, overview, score, everyone, upcoming, waiting] =
    await Promise.all([
      getDashboardExpenses(user, 1, { during }),
      getPayoutAccount(user.id),
      watchesAll || watchesOwn ? getBudgetOverview(year) : null,
      getMemberScore(user.id),
      canViewMemberScores(user.capabilities) ? getMemberScores() : null,
      getUpcoming(user),
      getWaitingOnOthers(user.id),
    ]);

  const todos = await getTodos(user, buildQueue(queueCandidates, user), day, { during });
  const behind = everyone?.filter((r) => (r.score.waiting[0]?.days ?? 0) > BEHIND_DAYS).length ?? 0;
  const groups: TodoGroup[] = behind
    ? [...todos.groups, { kind: "membersBehind", count: behind }]
    : todos.groups;
  // A faktura already on the list is not repeated in Kommande.
  const listed = new Set(todos.items.map((i) => i.id));

  const start = fiscal ? Date.parse(`${fiscal.fromDate}T00:00:00`) : new Date(year, 0, 1).getTime();
  const end = fiscal ? Date.parse(`${fiscal.toDate}T23:59:59`) : new Date(year + 1, 0, 1).getTime();
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));

  let budget: BudgetFlags | null = null;
  if (overview) {
    const units = watchesAll
      ? overview.units
      : overview.units.filter((u) => u.name !== null && owned.names.includes(u.name));
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
      payoutMissing={!payout.clearing || !payout.account}
      bands={bandTodos(todos.items)}
      groups={groups}
      waiting={waiting}
      calendar={upcoming.filter((u) => !listed.has(u.id))}
      budget={budget}
      fresh={mine.length === 0 && todos.items.length === 0}
      score={score.score}
    />
  );
}
