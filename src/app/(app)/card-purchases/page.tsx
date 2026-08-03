import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/current-user";
import { getBankTransactions, getCards } from "@/lib/data/bank";
import { userHoldsCard } from "@/lib/data/users";
import CardPurchasesClient from "./card-purchases-client";

export default async function CardPurchasesPage() {
  // Card purchases are only meaningful for a guild card holder — the nav hides
  // the link, and this keeps the route itself from being reachable by URL.
  const currentUser = await requireUser();
  if (!(await userHoldsCard(currentUser.id))) redirect("/dashboard");

  const [bankTransactions, cards] = await Promise.all([
    getBankTransactions(),
    getCards(),
  ]);
  return <CardPurchasesClient bankTransactions={bankTransactions} cards={cards} />;
}
