import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/current-user";
import { canBookkeep, canViewBookkeeping } from "@/lib/domain/permissions";
import {
  countCardlessTransactions,
  countUnaccountedPurchases,
  getBankTransactionPage,
  getCards,
} from "@/lib/data/bank";
import { userHoldsCard } from "@/lib/data/users";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import { ownedResultUnits } from "@/lib/server/result-units";
import BankClient from "./bank-client";
import { bankDefaultTab, type BankScope } from "./scope";
import { fiscalYearWhere, getFiscalYear } from "@/lib/server/fiscal-year";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("bank");

// One feed, three readings: Mina, the section's, and a resultatansvarig's (cards under a
// result unit they answer for, Card.resultUnit; read-only). The scope is settled here
// because it arrives in the URL: a reader who may not see the section's feed gets their own
// whatever they ask for. The client is told which scope it got and never decides one.
export default async function BankPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const params = await searchParams;

  const canSeeAll = canViewBookkeeping(user.capabilities);
  const [holdsCard, owned] = await Promise.all([userHoldsCard(user.id), ownedResultUnits(user)]);
  const answersForUnits = owned.names.length > 0;

  const scopes: BankScope[] = [
    ...(holdsCard ? (["mine"] as const) : []),
    ...(answersForUnits ? (["unit"] as const) : []),
    ...(canSeeAll ? (["all"] as const) : []),
  ];
  if (scopes.length === 0) redirect("/dashboard");

  const asked = scopes.find((s) => s === params.scope);
  const scope: BankScope = asked ?? scopes[scopes.length - 1];

  // Purchases on no card are only on the section's feed. Placing them is bookkeeping's; a
  // revisor sees them unplaced.
  const showsCardless = canSeeAll && scope === "all";
  const canPlaceCards = showsCardless && canBookkeep(user.capabilities);
  // The räkenskapsår narrows every tab, so the "Utan kort" tab's existence depends on it too.
  const fiscal = await getFiscalYear();
  const during = fiscal ? fiscalYearWhere(fiscal) : undefined;
  const [cardless, unaccounted] = await Promise.all([
    showsCardless ? countCardlessTransactions({ during }) : 0,
    // The nav's count for the reader's purchases with no utlägg yet (Att redovisa).
    countUnaccountedPurchases(user.id, {
      during,
      resultUnitNames: scope === "unit" ? owned.names : undefined,
    }),
  ]);
  // "Utan kort" is a tab only while non-empty (docs/navigation.md), so a link to it falls back
  // to the scope's own tab.
  const tab = params.tab === "nocard" && cardless === 0 ? undefined : params.tab;
  const query = parseListQuery({ ...params, tab }, { defaultTab: bankDefaultTab(scope) });

  const [page, cards, allCards] = await Promise.all([
    getBankTransactionPage(
      scope === "mine"
        ? { cardHolderId: user.id }
        : scope === "unit"
          ? { resultUnitNames: owned.names }
          : {},
      query,
      { during },
    ),
    // Only to decide whether the card column earns its width.
    holdsCard ? getCards({ holderId: user.id }) : Promise.resolve([]),
    // The card picker's register. Putting a no-card purchase on a card is bookkeeping's job.
    canPlaceCards ? getCards() : Promise.resolve([]),
  ]);

  return (
    <BankClient
      page={page}
      scope={scope}
      // Drawn only for somebody with two readings to choose between.
      scopes={scopes}
      cards={cards}
      allCards={allCards}
      cardless={cardless}
      unaccounted={unaccounted}
      placesCards={canPlaceCards}
      viewerId={user.id}
    />
  );
}
