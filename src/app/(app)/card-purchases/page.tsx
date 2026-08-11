import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/current-user";
import { getBankTransactionPage, getCards } from "@/lib/data/bank";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import { userHoldsCard } from "@/lib/data/users";
import CardPurchasesClient from "./card-purchases-client";
import { CARD_PURCHASES_DEFAULT_TAB } from "./tabs";

export default async function CardPurchasesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Card purchases are only meaningful for a guild card holder — the nav hides
  // the link, and this keeps the route itself from being reachable by URL.
  const currentUser = await requireUser();
  if (!(await userHoldsCard(currentUser.id))) redirect("/dashboard");

  // Both scoped to this member. A page ships what it asks for, so asking for
  // the whole feed would publish the whole feed — every purchase in the section
  // and the name of whoever's card it sat on — to anyone holding a card. The
  // screen only ever shows your own purchases; this is where that is decided,
  // not in the filter the client used to apply afterwards.
  //
  // "Oredovisade" is the tab this page opens on — it is what the page is for —
  // so it is also the filter in force before anyone picks one.
  const query = parseListQuery(await searchParams, { defaultTab: CARD_PURCHASES_DEFAULT_TAB });
  const [page, cards] = await Promise.all([
    getBankTransactionPage({ cardHolderId: currentUser.id }, query),
    getCards({ holderId: currentUser.id }),
  ]);
  return <CardPurchasesClient page={page} cards={cards} />;
}
