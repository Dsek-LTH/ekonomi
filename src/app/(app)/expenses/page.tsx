import { requireUser } from "@/lib/server/current-user";
import { getExpensePage, type ExpenseListScope } from "@/lib/data/expenses";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import { getReviewQueue } from "@/lib/data/review-queue";
import { getExpenseTabCounts } from "@/lib/data/nav-counts";
import {
  canBookkeep,
  canViewBookkeeping,
  canSendReminders,
  hasAttestRole,
} from "@/lib/domain/permissions";
import { ExpensesClient } from "./expenses-client";
import { expenseDefaultTab, type ExpenseScope } from "./scope";
import { fiscalYearWhere, getFiscalYear } from "@/lib/server/fiscal-year";
import { titled } from "@/lib/server/page-title";
import { ownedResultUnits } from "@/lib/server/result-units";

export const generateMetadata = titled("expenses");

// Utlägg: one list, three scopes, the stage as a tab (docs/navigation.md). `scope` arrives in the URL,
// so one that is not the reader's falls back; getExpensePage intersects with the viewer's scope either way.
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const { names: ownedUnits } = await ownedResultUnits(user);

  const scopes: ExpenseScope[] = [
    "mine",
    // The units they own, even for the skattmästare: everyone's is "Alla". Empty for anybody who owns none.
    ...(hasAttestRole(user.capabilities) && ownedUnits.length > 0 ? (["unit"] as const) : []),
    ...(canViewBookkeeping(user.capabilities) ? (["all"] as const) : []),
  ];
  const scope: ExpenseScope = scopes.find((s) => s === params.scope) ?? scopes[scopes.length - 1];

  const query = parseListQuery(params, { defaultTab: expenseDefaultTab(scope) });
  const listScope: ExpenseListScope =
    scope === "mine"
      ? { kind: "mine" }
      : scope === "unit"
        ? { kind: "attestable" }
        : { kind: "all" };

  // Bokför and Granska buttons: a revisor gets none. Utlägg konterade by this viewer are somebody else's to bokföra.
  const books = scope === "all" && canBookkeep(user.capabilities);
  // The räkenskapsår narrows every tab.
  const fiscal = await getFiscalYear();
  const during = fiscal ? fiscalYearWhere(fiscal) : undefined;
  const [page, queue, waiting] = await Promise.all([
    getExpensePage(user, listScope, query, { during }),
    books ? getReviewQueue(user, { during }) : null,
    getExpenseTabCounts(user, scope, fiscal),
  ]);

  return (
    <ExpensesClient
      page={page}
      waiting={waiting}
      scope={scope}
      scopes={scopes}
      ownBooked={queue?.ownIds ?? []}
      canRemind={canSendReminders(user.capabilities)}
    />
  );
}
