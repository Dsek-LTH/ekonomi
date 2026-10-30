import { requireUser } from "@/lib/server/current-user";
import { getExpensePage, type ExpenseListScope } from "@/lib/data/expenses";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import { getReviewQueue } from "@/lib/data/review-queue";
import { canBookkeep, canViewBookkeeping, canSendReminders, hasAttestRole } from "@/lib/domain/permissions";
import { ExpensesClient } from "./expenses-client";
import { expenseDefaultTab, type ExpenseScope } from "./scope";
import { fiscalYearWhere, getFiscalYear } from "@/lib/server/fiscal-year";

// Utlägg: one list, three readings of it, and the stage as a tab. See
// docs/navigation.md.
//
// It used to be three pages. This one listed your own, Att attestera listed
// what you may attest, and Bokföring listed the signed ones for the treasury.
// All three were the same query with a different subject, and each put the
// stage somewhere else (a filter here, tabs there, a page of its own for
// attest). Whose is the scope switch now, and the stage is a tab on all three.
//
// Which scopes a reader has is settled here, as on /bank: `scope` arrives in
// the URL, where anybody can type it, and one that is not theirs is answered
// with the one they would have landed on. What they may see at all is applied
// underneath either way (getExpensePage always intersects with the viewer's
// scope), so a hand-typed ?scope=all widens nothing.
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  // In the order the track draws them, narrowest first.
  const scopes: ExpenseScope[] = [
    "mine",
    // What the reader may attest: their result units' utlägg, or anyone's
    // for an admin. Not a unit filter but the attest authority itself, so
    // your own and the units you do not answer for stay out of it.
    ...(hasAttestRole(user.capabilities) ? (["unit"] as const) : []),
    ...(canViewBookkeeping(user.capabilities) ? (["all"] as const) : []),
  ];
  // The one asked for, if it is theirs. Otherwise the scope the reader's work
  // is on: the section's for bookkeeping, their units' for an attester, their
  // own for everyone else.
  const scope: ExpenseScope = scopes.find((s) => s === params.scope) ?? scopes[scopes.length - 1];

  const query = parseListQuery(params, { defaultTab: expenseDefaultTab(scope) });
  const listScope: ExpenseListScope =
    scope === "mine" ? { kind: "mine" } : scope === "unit" ? { kind: "attestable" } : { kind: "all" };

  // The treasury's things to do sit on the section's reading: the column of
  // Bokför and Granska buttons. A reader (a revisor) bokför nothing, so is
  // offered no way in. The queue is asked for which of the konterade ones this
  // viewer konterade, since those are somebody else's to bokföra.
  const books = scope === "all" && canBookkeep(user.capabilities);
  // The räkenskapsår narrows every tab, the work ones too: picking 2025 is
  // asking to see 2025. See docs/navigation.md.
  const fiscal = await getFiscalYear();
  const during = fiscal ? fiscalYearWhere(fiscal) : undefined;
  const [page, queue] = await Promise.all([
    getExpensePage(user, listScope, query, { during }),
    books ? getReviewQueue(user, { during }) : null,
  ]);

  return (
    <ExpensesClient
      page={page}
      scope={scope}
      scopes={scopes}
      ownBooked={queue?.ownIds ?? []}
      canRemind={canSendReminders(user.capabilities)}
    />
  );
}
