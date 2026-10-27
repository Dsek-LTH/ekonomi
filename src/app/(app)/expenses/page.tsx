import { requireUser } from "@/lib/server/current-user";
import { getExpensePage } from "@/lib/data/expenses";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import { canViewBookkeeping, canSendReminders, hasAttestRole } from "@/lib/domain/permissions";
import { ExpensesClient } from "./expenses-client";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const query = parseListQuery(await searchParams);

  // Whose utlägg the list is about. Anyone who can see past their own gets the
  // toggle and starts on their own; everyone else has only the one answer.
  //
  // Note what this does and does not decide: it picks which *subject* the page
  // has. What the viewer may see at all is applied underneath it either way
  // (getExpensePage always intersects with the viewer's scope), so a hand-typed
  // ?view=ALL widens nothing for someone with no business seeing more.
  const canToggleScope = canViewBookkeeping(user.capabilities) || hasAttestRole(user.capabilities);
  const showOwnOnly = !canToggleScope || query.view !== "ALL";

  const page = await getExpensePage(user, { kind: showOwnOnly ? "mine" : "all" }, query);

  return (
    <ExpensesClient
      page={page}
      canToggleScope={canToggleScope}
      showOwnOnly={showOwnOnly}
      canRemind={canSendReminders(user.capabilities)}
    />
  );
}
