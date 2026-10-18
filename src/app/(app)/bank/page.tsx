import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/current-user";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { getBankTransactionPage, getCardlessTransactions, getCards } from "@/lib/data/bank";
import { userHoldsCard } from "@/lib/data/users";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import { ownedResultUnits } from "@/lib/server/result-units";
import BankClient from "./bank-client";
import { bankDefaultTab, type BankScope } from "./scope";

// One feed, three readings of it.
//
// This page and /card-purchases were the same query (`getBankTransactionPage`)
// drawn twice: the same four columns, the same three server-side tabs, one
// scoped to the section and one to the reader. What differed was the audience
// and the verb, which is a switch rather than a second screen. So it is one
// page with a Mina/Alla track, the way Utlägg and Intäkter already ask the same
// question.
//
// The scoping was a hard fact when it lived in two routes: one asked for the
// whole feed and one could not, and it is now a rule this function enforces.
// Which is why it is settled here and nowhere else: `scope` arrives in the URL,
// where anybody can type it, and a reader who may not see the section's feed is
// answered with their own no matter what they asked for. The client is told
// which scope it got and never decides one.
//
// The third reading is a resultatansvarig's: the purchases on the cards an
// admin has put under a result unit they answer for (Card.resultUnit). It is
// for reading. Redovisa stays with the holder, and deleting and placing cards
// stay with bookkeeping, both of which the client already decides per row.
export default async function BankPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const canSeeAll = canAccessBookkeeping(user.capabilities);
  const [holdsCard, owned] = await Promise.all([
    userHoldsCard(user.id),
    ownedResultUnits(user),
  ]);
  const answersForUnits = owned.names.length > 0;

  // The readings this person has, in the order the track draws them.
  const scopes: BankScope[] = [
    ...(holdsCard ? (["mine"] as const) : []),
    ...(answersForUnits ? (["unit"] as const) : []),
    ...(canSeeAll ? (["all"] as const) : []),
  ];
  // No card, no unit and not the books: there is no reading of this feed for them.
  if (scopes.length === 0) redirect("/dashboard");

  // What was asked for, if it is one of theirs. Otherwise the first they have:
  // your own purchases when you hold a card, the same as Utlägg opens on Mina,
  // then your unit's, then the whole feed.
  const asked = scopes.find((s) => s === params.scope);
  const scope: BankScope = asked ?? scopes[0];

  const query = parseListQuery(params, { defaultTab: bankDefaultTab(scope) });

  // Purchases on no card are bookkeeping's to place, and only on the section's
  // feed, since they are on nobody's own.
  const canPlaceCards = canSeeAll && scope === "all";

  const [page, cards, allCards, cardless] = await Promise.all([
    getBankTransactionPage(
      scope === "mine"
        ? { cardHolderId: user.id }
        : scope === "unit"
          ? { resultUnitNames: owned.names }
          : {},
      query,
    ),
    // Only to decide whether the card column earns its width, so only asked for
    // where it could be shown.
    holdsCard ? getCards({ holderId: user.id }) : Promise.resolve([]),
    // The register behind the card picker. A purchase the export named no card
    // on is on nobody's own feed, so putting it on one is bookkeeping's job and
    // only the section-wide reading shows those rows at all.
    canPlaceCards ? getCards() : Promise.resolve([]),
    canPlaceCards ? getCardlessTransactions() : Promise.resolve([]),
  ]);

  return (
    <BankClient
      page={page}
      scope={scope}
      // The track is drawn only for somebody who has two readings to choose
      // between. One scope is not a choice, and a switch that cannot switch is
      // a control that reads as broken.
      scopes={scopes}
      cards={cards}
      allCards={allCards}
      cardless={cardless}
      viewerId={user.id}
    />
  );
}
