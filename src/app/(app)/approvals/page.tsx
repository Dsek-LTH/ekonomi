import { requirePage } from "@/lib/server/current-user";
import { getExpensePage } from "@/lib/data/expenses";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import { canAccessBookkeeping, hasAttestRole } from "@/lib/domain/permissions";
import { ApprovalsClient } from "./approvals-client";
import { APPROVALS_DEFAULT_TAB } from "./tabs";

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // The same predicate the nav hides the link behind. Someone who can attest
  // nothing would land on an empty queue anyway, but "your queue is empty" and
  // "this page is not yours" are different statements and the second is the
  // true one — say it here rather than letting the filtering imply it.
  const user = await requirePage(hasAttestRole);

  // "Väntar" is the tab this page opens on, so it is also the filter in force
  // before anyone has picked one — see parseListQuery.
  const query = parseListQuery(await searchParams, { defaultTab: APPROVALS_DEFAULT_TAB });

  // Bookkeeping roles get a second view of this page: the whole section's attest
  // queue, not only the part they hold authority over, so someone can chase a
  // stuck utlägg wherever it sits. It widens nothing — `expenseScopeOf` already
  // resolves these roles to "everything", so this is a different question about
  // the same set, not a reach past it. Anyone else isn't offered the toggle.
  const canToggleScope = canAccessBookkeeping(user.capabilities);
  const showOwnOnly = !canToggleScope || query.view !== "ALL";

  // Two different questions, each asked of the database directly.
  //
  // "Mine" means what this viewer may actually attest — not everything they are
  // allowed to look at. Those differ: an assistant treasurer sees every utlägg
  // for bookkeeping, and a resultatansvarig sees whole utlägg that are only
  // partly theirs when the cost is split across result units. That rule is
  // `canAttestAllocation`, resolved into a query in lib/data/attest-scope.ts —
  // it is authority rather than approval state, so already-attested rows still
  // belong here, under the "Attesterade" tab.
  const page = await getExpensePage(
    user,
    { kind: showOwnOnly ? "attestable" : "attestChain" },
    query,
  );

  return (
    <ApprovalsClient
      page={page}
      canToggleScope={canToggleScope}
      showOwnOnly={showOwnOnly}
    />
  );
}
