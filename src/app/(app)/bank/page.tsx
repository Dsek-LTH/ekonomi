import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/current-user";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { getBankTransactionPage, getCards } from "@/lib/data/bank";
import { userHoldsCard } from "@/lib/data/users";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import BankClient, { type BankScope } from "./bank-client";

// One feed, two readings of it.
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
export default async function BankPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const canSeeAll = canAccessBookkeeping(user.capabilities);
  const holdsCard = await userHoldsCard(user.id);
  // Neither a card nor the books: there is no reading of this feed for them.
  if (!canSeeAll && !holdsCard) redirect("/dashboard");

  const asked = params.scope === "mine" ? "mine" : params.scope === "all" ? "all" : null;
  // Bookkeeping opens on the whole feed, because that is the job; everybody
  // else has exactly one scope and it is not a choice.
  const scope: BankScope = canSeeAll ? (asked ?? "all") : "mine";

  const query = parseListQuery(params, {
    // Your own purchases open on the ones not yet accounted for. That is what
    // the page was for when it was Kortköp, and it is still the only actionable
    // thing in the list. The section's feed opens on all of it.
    defaultTab: scope === "mine" ? "UNMATCHED" : "ALL",
  });

  const [page, cards, allCards] = await Promise.all([
    getBankTransactionPage(scope === "mine" ? { cardHolderId: user.id } : {}, query),
    // Only to decide whether the card column earns its width, so only asked for
    // where it could be shown.
    holdsCard ? getCards({ holderId: user.id }) : Promise.resolve([]),
    // The register behind the card picker. A purchase the export named no card
    // on is on nobody's own feed, so putting it on one is bookkeeping's job and
    // only the section-wide reading shows those rows at all.
    canSeeAll && scope === "all" ? getCards() : Promise.resolve([]),
  ]);

  return (
    <BankClient
      page={page}
      scope={scope}
      // The track is drawn only for somebody who has two readings to choose
      // between. One scope is not a choice, and a switch that cannot switch is
      // a control that reads as broken.
      canPickScope={canSeeAll && holdsCard}
      cards={cards}
      allCards={allCards}
      viewerId={user.id}
    />
  );
}
