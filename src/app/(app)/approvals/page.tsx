import { requirePage } from "@/lib/server/current-user";
import { getExpenseSummaries } from "@/lib/data/expenses";
import { canAccessBookkeeping, hasAttestRole } from "@/lib/domain/permissions";
import { isInAttestChain } from "@/lib/domain/status";
import type { Expense } from "@/lib/domain/types";
import { ApprovalsClient } from "./approvals-client";

export default async function ApprovalsPage() {
  // The same predicate the nav hides the link behind. Someone who can attest
  // nothing would land on an empty queue anyway, but "your queue is empty" and
  // "this page is not yours" are different statements and the second is the
  // true one — say it here rather than letting the filtering imply it.
  const user = await requirePage(hasAttestRole);

  // Bookkeeping roles get a second view of this page: the whole section's attest
  // queue, not only the part they hold authority over, so someone can chase a
  // stuck utlägg wherever it sits. That view costs no extra query and widens
  // nothing — `expenseScopeOf` already resolves these roles to "everything", so
  // the queue is a subset of the list below rather than a reach past it. Anyone
  // else isn't offered the toggle and only receives `mine`.
  const canToggleScope = canAccessBookkeeping(user.roles);
  const expenses = await getExpenseSummaries(user);

  // "Mine" means what this viewer may actually approve — not everything they're
  // allowed to look at. Those differ: an assistant treasurer sees every expense
  // for bookkeeping, and a resultatansvarig sees whole expenses that are only
  // partly theirs when the cost is split across result units. Without this
  // filter, other result units' expenses show up in the approval queue.
  //
  // `canAttest` is authority, not approval state, so already-approved rows stay
  // in the "Attesterade" tab.
  const mine = (e: Expense) => e.allocations.some((a) => a.canAttest);

  // Ship the union of the two views and nothing more. The client picks between
  // them so the toggle is instant, but a page that only ever renders the attest
  // queue has no business carrying every draft in the section.
  return (
    <ApprovalsClient
      expenses={expenses.filter((e) => mine(e) || (canToggleScope && isInAttestChain(e.status)))}
      canToggleScope={canToggleScope}
    />
  );
}
