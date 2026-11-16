import { redirect } from "next/navigation";

import {
  getBoardMembers,
  getBoardPrices,
  getBoardWithdrawals,
  hasWithdrawals,
} from "@/lib/data/board";
import { today } from "@/lib/domain/date";
import { canBookkeep, canViewBookkeeping, hasBoardTab } from "@/lib/domain/permissions";
import { requireUser } from "@/lib/server/current-user";
import { titled } from "@/lib/server/page-title";

import WithdrawClient from "./withdraw-client";

export const generateMetadata = titled("board");

// Logga: what a board member took from the café stock, logged on a phone. The treasurer may log it for anybody.
// Mina uttag (./history) and Fakturering (./invoices) are the rest of Styrelseborder. See docs/stock.md.
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  const user = await requireUser();
  const member = hasBoardTab(user.capabilities);
  const manage = canBookkeep(user.capabilities);
  if (!member && !manage) {
    // Nothing to log: to whatever else of the board's tab this reader has.
    if (await hasWithdrawals(user.id)) redirect("/board/history");
    redirect(canViewBookkeeping(user.capabilities) ? "/board/invoices" : "/dashboard");
  }

  const [prices, members, logged] = await Promise.all([
    getBoardPrices(),
    manage ? getBoardMembers() : [],
    getBoardWithdrawals({ loggedById: user.id }),
  ]);

  return (
    <WithdrawClient
      // Only what has a price can be taken.
      products={prices
        .filter((p) => p.priceOre != null)
        .map((p) => ({
          id: p.productId,
          name: p.name,
          ean: p.ean,
          priceOre: p.priceOre!,
          onHand: p.onHand,
        }))}
      members={manage ? members : null}
      self={member ? user.id : null}
      picked={manage ? ((await searchParams).member ?? null) : null}
      // What was written down today can still be taken back from here.
      loggedToday={logged.filter((w) => w.fresh)}
      today={today()}
    />
  );
}
